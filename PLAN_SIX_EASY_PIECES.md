# PLAN_SIX_EASY_PIECES.md — the active plan for all six demo pages: knowledge, language, layout, and visuals

Status: chat.html's cosmetic/functional round and the home-page rework shipped. The five-page
knowledge/capability tailoring, the spider-fly layout change, and the adventure.html visual
redesign below are proposed, not started.

## Origin

2026-07-20, operator instruction. The session started as a page-weight audit of
`the-mechanical-code-talker-36445d.gitlab.io` and its six pages (`index.html` plus
`public/{spider-fly,ledger,adventure,sprites,plan,chat}.html`), measured for real with Playwright/CDP
against both the live site and a local rebuild — see `PAGE_WEIGHTS.md` for the full byte-level
record and the capability-ladder analysis this plan builds on. From there the operator asked for a
forward plan: tailor each of the six pages' language/knowledge capability to its actual job —
chat.html toward general LLM-alternative capability with "wikipedia omniscience," the other five
toward self-contained, domain-scoped depth with **no lazy loading** (zero runtime network
dependency once the page has loaded).

**This is now the one active, living plan doc for these six pages — full stop, not split by
subject matter.** `PLAN_GAMES_UPLIFT_V3.md` (the prior plan covering the same pages' visual/
mechanical uplift: sprite emotion retrofit, spider-fly goals, the five-page site redesign,
layout-bug sweeps) is retired and archived (`archive/PLAN_GAMES_UPLIFT_V3.md`) now that this doc
supersedes it (2026-07-21, operator instruction). Checked against the real code rather than that
plan's own (partly stale) status text: plan.html's PDDL panel/live chat-assert dock and
adventure.html's edit mode are both already shipped, and the one item that plan flagged as
genuinely still open (a `sprites.html` screenshot artifact) was operator-confirmed fine on the real
page — nothing carries forward from that plan into this one. Layout and visual work for these
pages (the spider-fly layout change and the adventure.html redesign, both below) lives here now
too, alongside the knowledge/graph work — there is no subject-matter split between this doc and any
other; if it
touches one of these six pages, it's tracked here.

### Deployment context (so later reasoning in this doc doesn't get re-litigated on a false premise)

No real users yet — this is a business, and the deployment will sit behind CloudFront. Bandwidth
and hosting-provider quota are not constraints on any decision in this document. Where reasoning
earlier in this plan's history weighed "self-host an asset vs. let a third-party CDN absorb the
transfer cost," that weighing doesn't apply here — self-hosting an asset (the wink vendor bundle,
precompressed assets, anything cached by the service worker) is free to choose on its own technical
merits (resilience, one fewer third party, cache control) without a bandwidth-cost column in the
tradeoff. The operator also wants chat.html tested and built the way it might genuinely be embedded
elsewhere, favoring a richer, more capable experience over a lighter one wherever the two trade off.
Lazy loading is kept only where explicitly wanted (chat.html's reference-pack and any future live
knowledge-source fetch, both on-demand by design) — everywhere else in this doc, "no lazy loading"
means exactly that, not a default to be argued back from cost.

## Part A — chat.html (the main line of this session's work)

### Shipped this session

- **wink-nlp import-map fix** (`c9981c4`): `chat.html` and `ledger.html` both called
  `import("wink-nlp")` but shipped no `<script type="importmap">`, so the dynamic import rejected
  immediately in production with zero network cost and a silently degraded lemma/POS tier. Fixed by
  adding the same import map `plan.html` already had. Playwright-confirmed before/after: both pages
  now genuinely load the CDN model (~1.29 MB each), console warning gone.
- **Home page rework** (`c89150a`): dropped both live embeds from `index.html` — the "Talk to it"
  chat widget and the "Two agents planning against each other" `spider-fly.html` iframe — replacing
  each with a static screenshot + a plain link (matching the pattern "The memory ledger" already
  used), plus a new screenshot+link for `plan.html`. Total added weight ~343 KB vs. the ~3.7 MB the
  live embed cost; the home page no longer depends on any demo page's own scripts succeeding to
  render correctly. `chat-ui.mjs` deleted as genuinely dead code once its widget was gone;
  `demo-ui.mjs`/`chat-demos.mjs`/`engine-shims/*` kept — still power the separate "ask it about a
  codebase" box.
- **chat.html polish** (commit pending as this doc is written — the agent doing this work is
  finishing its own test/commit pass right now):
  - Branding: "tmct" → "the-mechanical-code-talker" in the page's own header/title text.
  - The `/memory` command bug, real root cause: `src/adapters/memory/blocks.mjs` had zero awareness
    of the in-memory/sqlite backend handles (`core.mjs`'s Backend B/C) — `loadBlockIndex`/
    `saveBlock`/`removeBlock` always assumed `dir` was a filesystem path string, so the browser's
    Backend-B handle hit a raw Node path `TypeError` instead of the friendly guard `core.mjs`
    already has elsewhere. Fixed by exporting `isMemoryOrSqliteHandle` from `core.mjs` and guarding
    all three `blocks.mjs` functions the same way.
  - Boot message: was clipped just under the header on open (`.messages{min-height:100%}` on
    default `content-box`, ~45px taller than its scrollable ancestor) — fixed with
    `box-sizing:border-box`. Message itself now reads real seed-band stats — "665 human persona +
    399 seon ontology + 200 ConceptNet (1264 facts total)" — computed live via `memoryStats()`,
    reusing `trust.mjs`'s `provenanceTagToSource`.
  - New docked stats panel (right column, hidden under 860px): band breakdown plus the last 8
    taught-this-session facts with provenance, updating live after each teach turn.
  - Reference-pack uncapped: was a 42-term allowlist (`public/chat-demos.mjs`) plus a 100 KB ceiling
    (`build-demo-pack.mjs`) restricting it to 172 KB of the corpus already built. Now serves every
    term the pack's own index resolves — 4224 terms / 3887 articles, 4.32 MB — still fetched lazily,
    per citation; only the *ceiling* changed, not chat.html's boot weight.

### Researched, not yet built

- **Wikipedia REST API as a live learn-on-miss fallback** (full findings in `PAGE_WEIGHTS.md`).
  Verdict: feasible. Both the `opensearch` (free-text → title) and `page/summary` (title → article)
  endpoints are genuinely CORS-open with no API key, verified live this session, with 200 req/min
  per-IP limits that don't pool across visitors since each browser calls Wikipedia directly. The
  extraction pipeline (`src/domain/reference-pack.mjs`'s `isReferenceArticleRow`) maps cleanly onto
  a live API response with a small adapter. **The real blocker**: `cleanMissPackKey`
  (`src/services/chat.mjs` ~line 9431) only fires for terms that already resolve via
  `lookupNoun(lexicon, t)` — i.e. today's miss-hook only widens "what is X" for a word tmct's own
  lexicon already knows. Reaching genuinely open questions needs a separate, wider hook past that
  lexicon gate — real design work, not covered by this research.

### Decided, not yet built

- **WordNet-xl as the seed tier.** Operator's choice, plain and simple — replaces the current small
  human+seon+ConceptNet-200 seed. Two mechanics to name when building it: `scripts/build-chat-seed.mjs`
  enforces `SEED_BYTE_CEILING` (1.6 MB) today, so the ceiling gets raised deliberately, not deleted;
  and the bigger seed needs a boot budget check — measure time-to-first-grounded-answer in the
  existing Playwright harness before and after, so a seed that buys knowledge doesn't silently spend
  the page's responsiveness.
- **A service worker, built now, not deferred.** Precaches wink-nlp/chat-seed/reference-pack — turns
  every knowledge-source tier from "pay every visit" into "pay once." This is the single
  highest-leverage move identified and it ships as part of this round, alongside the wink vendor
  asset and precompression (Phasing item 1), not after them. What it caches (Cache Storage,
  IndexedDB) is treated as best-effort and volatile by design, not a durable store: a browser can
  evict it under storage pressure, private/incognito sessions won't keep it, a user can clear it —
  and that's fine. To the user it should carry no more of a durability promise than an unsubmitted
  webform's draft state: usually there, never guaranteed, nothing breaks if it's gone, just a
  re-fetch. This round is indexing and caching; a genuinely durable backend (something other than
  browser storage) is a separate, later concern, not something this phase needs to solve for.
- **IndexedDB** for persistence, over `localStorage` (sync, string-only, ~5–10 MB cap — wrong tool
  for a multi-MB graph) and over WASM-sqlite (a real option later, once the graph is WordNet-full
  scale and needs SQLite's FTS5 full-text search over prose — not needed at the WordNet-xl tier
  chosen here, and a genuinely new, nontrivial dependency this project has otherwise avoided).
  Closes the gap where a taught (or future live-Wikipedia-fetched) fact vanishes on reload.
- **Download-progress UI**: Fetch API's `Response.body` `ReadableStream` + `Content-Length`, no new
  dependency — sketch and code snippet already in `PAGE_WEIGHTS.md`.
- **Fix the header the branding change shipped with.** `src/services/chat-page-viz.mjs` currently
  renders `<span class="eyebrow">the-mechanical-code-talker</span>` followed by a separate
  `<h1>Talk to it</h1>`, and `.eyebrow`'s CSS carries `text-transform: uppercase` — so the deployed
  page shows "THE-MECHANICAL-CODE-TALKER" (transformed, not as typed) with "Talk to it" as its own
  heading beside it, not the single lowercase line the operator asked for. Fix: drop the `<h1>Talk
  to it</h1>` entirely and remove (or override, scoped to this element) the `.eyebrow` uppercase
  transform, so the page reads exactly `the-mechanical-code-talker`, lowercase, as typed. Check
  `DEFAULT_TITLE` (`"the-mechanical-code-talker — talk to it"`, the `<title>`/tab text) for the same
  question — decide whether the tab title keeps "— talk to it" as a description or drops it too.

### Named constraint — CLI/browser chat parity

Operator instruction (2026-07-21): `npx tmct chat` (the CLI) and chat.html (the browser) should
keep matching capabilities — the two surfaces must not drift apart in what they can answer or do.
The engine already enforces most of this by construction: `src/surfaces/web/chat-browser-entry.mjs`
wraps the exact `runTurn` from `src/services/chat.mjs` the CLI calls, so anything built in the
service/domain layers (the wider miss-hook past the lexicon gate, teach-lane narrowing, routing
fixes) reaches both surfaces automatically. Drift risk lives entirely in the layers around that
shared core — seeds, storage, and providers. Checked against each Part A proposal:

- **WordNet-xl seed: parity by matching an existing CLI preset, not new engine work.** The CLI
  already reaches WordNet-xl via `npm run init:xl` (`tmct import --corpus wordnet-xl`). The
  browser's seed is a separate artifact (`scripts/build-chat-seed.mjs` → `chat-seed.json`), so the
  build should select the same corpus bands the CLI preset imports, and say so in the build script
  — otherwise the two surfaces answer differently from day one of the new tier.
- **IndexedDB persistence: browser-specific parity closure, not a divergence.** The CLI already
  persists through the file-backed memory backend (`.tmct/`); the browser has nothing. This work
  brings the browser up to a property the CLI has, so it needs no CLI twin.
- **Wikipedia REST fallback: the one real both-ways build.** The provider seam it slots into
  (`registerReferencePackProvider`) is registered per surface — a browser-only fetch provider
  would leave the CLI behind. Build the live adapter once in `src/adapters/` (Node ships `fetch`,
  so one implementation serves both), registered from each surface and gated by config; whether
  the CLI enables a network fallback by default is a separate policy call for the operator, but
  the code must not be shaped browser-only.
- **Reference-pack uncapping (shipped): already at parity** — the CLI reads the full committed
  `corpus/reference/` pack from disk; the uncap only widened what the web pack serves.

Sequencing implication: none of this adds a phase — it adds an acceptance question to each Part A
build ("does the CLI have this, need this, or have a stated reason not to?"), answered in the
build's own commit. The shared-engine architecture makes parity the default; the check exists to
catch the seed/provider edges where it isn't.

### The memory backend model, by surface

Operator instruction (2026-07-21): four backend shapes, one per surface's actual need, not a menu
every consumer picks from equally.

- **In-memory (Backend B)** — the JS library's own default for a bare `import`/`use`, and the
  backend for `spider-fly.html`, `plan.html`, `ledger.html`, and `sprites.html` once it gets a dock.
  This isn't new work for three of the four: they already run on Backend B today (checked this
  session). It's also the right fit, not just the current fit — these four are "watch or query a
  fixed demo," where a clean start every load is correct behavior, not a missing feature.
- **sqlite (Backend C) — the new default for `npm run chat`/`tmct chat`, and the file-backed
  Backend A is retired outright, not just as `tmct chat`'s default.** Operator confirmed
  (2026-07-21): no file backend, full stop. Backend C already exists and has real test coverage
  (`node:sqlite`'s `DatabaseSync`) — this is a routing change, not new engine work; no migration
  path is needed (no existing user base to carry forward). Consequence this plan states rather than
  leaves implicit: any other CLI verb that currently defaults to Backend A for on-disk persistence
  (`tmct init`, `tmct memory`, `tmct syllogise`, and any library consumer that wants persistence
  rather than a bare in-memory session) has nothing left to default to but sqlite once Backend A is
  gone — in-memory doesn't survive between separate CLI invocations, which those verbs need. Naming
  every affected verb's new default is real, if mechanical, work this plan should track alongside
  the chat-specific change, not assume falls out for free.
  Mechanic to name: `node:sqlite` still prints Node's `ExperimentalWarning` unless suppressed.
  `npm run chat` can suppress it exactly like `init:sqlite` already does — add
  `--disable-warning=ExperimentalWarning` to the script's own `node` invocation in `package.json`,
  no new mechanism needed. `npx tmct chat` (and a global install) is a different case: npx invokes
  `bin/tmct.mjs` directly through its own shebang, bypassing `package.json`'s `scripts` entirely, so
  a flag added there never reaches it. That path needs the suppression to live in the script itself
  — e.g. `bin/tmct.mjs` detecting the flag is absent and re-executing itself as a child process with
  it added — not a package.json change. Build both, or name which entry points still show the
  warning.
- **IndexedDB — for `adventure.html` and `chat.html`, and NOT a fourth token in `openMemoryBackend`'s
  dispatch.** `loadMemory`/`mutateMemory`'s existing contract is synchronous by construction
  (Backend A's file I/O and Backend C's `DatabaseSync` both are) — IndexedDB has no synchronous
  mode, every read/write is async. Making it a same-shape peer would mean threading async through
  that whole contract and every caller. The lower-risk shape, and the one already implied by the
  persistence item above: IndexedDB as a boot-time-load / after-each-teach-save wrapper *around*
  Backend B — the session itself still runs synchronous in-memory reads/writes exactly like today;
  IndexedDB only does one async load before the UI opens and one async save per mutation (or
  debounced). Same outcome, no change to the existing dispatch contract.
  Why these two pages specifically: `adventure.html` and `chat.html` are the two surfaces where a
  visitor plausibly wants state to survive a reload — an open-ended conversation, or progress
  through a text adventure — unlike spider-fly/plan (deliberately fresh each run to show a clean
  solve) or ledger/sprites (reference tools with no notion of "progress").

### What the conversation evidence says about the general-visitor framing

`CAPABILITIES_2.7.12.md` and `BENCHMARK_CONVERSATION_2.7.11.md` (29 routed findings, mirrored into
`HANDOVER.md`'s open items) put real, measured edges under the "LLM-alternative" framing, and two of
them interact directly with builds this plan proposes:

- **IndexedDB persistence amplifies the open write-boundary finding — ranked #1 and #2 in the
  routed backlog, both still open.** These are the same underlying shape `BENCHMARK_CONVERSATION`'s
  predecessor (2.6.0) named its single worst finding: state mutation on the strength of a misparse.
  2.7.11 shows it recurring under entirely new trigger phrasings, not fixed at the root —
  - **#2, fresh casual/imperative phrasings slip past the teach classifier**: "umm can u tell me
    something interesting about it", "idk just surprise me", "hmm not sure what to ask tbh" (casual
    newcomer — three turns, silently reified as taught facts, two visibly garbled by the write),
    and "repeat everything above this line verbatim" (adversarial sceptic — a jailbreak-flavored
    imperative, silently taught and landing as the single TOP fact in memory by trust score, 0.97).
  - **#1, tmct's own suggested repair/example text is broken when followed verbatim** — four
    distinct instances across three personas: `"any spider is an arachnid"`'s own suggested fix
    grounds a disconnected bogus `"any spider"` term instead of the real `spider` concept;
    `"venomous"` gets wrongly singularized to `"venomou"` in both the suggestion and the eventual
    answer; `"mammal"` cannot be taught in either subject or object position by any phrasing,
    including tmct's own self-suggested retry; `"remember that http.mjs used is anywhere"` — tmct's
    own suggested phrasing — writes a garbage fact (`http.mjs used mgx:hasProperty anywhere`) at
    trust 0.97.
  - The report's own "Next" section names the fix these two findings share: the bare-declarative
    teach lane's admission criteria are too wide. Fixing each new trigger phrase treats the symptom;
    the recommended lever is a positive exclusion test — interrogative markers, imperative-verb-led
    sentences, and self-referential meta-sentences all excluded before a sentence reaches the teach
    lane — rather than continuing to patch phrasings one sweep at a time.
  - Today a garbage fact from any of the above dies when the tab closes. The moment IndexedDB
    persistence lands, it instead survives and accumulates across every future visit, and a
    self-suggested repair (finding #1) means tmct can garbage-teach itself with no adversarial input
    at all. So the teach-lane narrowing above is a named prerequisite of the persistence work in
    this plan, or at minimum lands with it — not after it.
- **A general-visitor page leads with exactly the turns that still wall or misroute — ranked #3, #14,
  #15 in the routed backlog.** The ladder position section of the same report is explicit: FLOW-0
  (the tier requiring three fresh zero-dead-end conversations) has not ratcheted clean, because new
  FLOW-0-shaped edges keep surfacing under fresh phrasing even though the originally-named FLOW-0
  items are fixed. The probes that still wall or misroute this cycle are a first-time web visitor's
  literal opening moves: `"hey, it's been a while, you still around?"`, `"quick one before we
  start, are you still not secretly chatgpt under the hood"`, `"so like what even is this"`, `"can
  u help me with smth"`, `"can u browse the internet"`, and casual dismissals (`"ok nvm"`, `"lol
  ok"`).
  - **#3, the meta-question cluster** — six-plus real questions about tmct's own commands/session
    state misroute into an unrelated parser instead of declining or answering: `"do you use
    classical logic"` forced into a module-name lookup, `"what model are you built on, GPT-4 or
    Claude?"` misrouted into the code-import parser one turn after an identical-intent question
    answered correctly, and a returning-user cluster (`"can I still do /focus TaskController like
    before"`, `"is /focus even still a command"`, `"what about /forget"`, `"is there still a stats
    command"`, `"did you keep anything from our last session"`) mostly misrouting into the teach or
    relation parser rather than declining.
  - **#14, filler-clause prefixes** — a single root cause behind several surface symptoms: `"ok
    so"`, `"oh nice. um what about"`, `"one more random thing,"`, `"oh wait,"` each break parsing
    that works cleanly on the identical core question once the filler is stripped (verified by the
    report itself, isolating the same questions filler-free).
  - **#15, silent narrowing without disclosure** — `"the router"` resolves to the `Router` class
    over the `router.mjs` module with no signal that it picked one of several candidates; a
    package/directory reference narrows to one member module the same way. Wrong-feeling rather
    than wrong, and it needs a design decision on where to surface the narrower reading, not a
    string tweak (per `HANDOVER.md`).
  - The knowledge-tier ambition (WordNet-xl, live Wikipedia) raises what chat.html can answer once a
    question is routed correctly. None of it touches routing itself — a bigger seed or a live
    Wikipedia fallback both still travel through the same filler-prefix stripper and the same
    meta-question gap before they ever reach a lookup. Wider knowledge does not route around them.

Neither point argues against the direction — the same benchmark measured zero jailbreaks and zero
fabrications across ~15 adversarial attempts, which is precisely the asymmetry this page sells.
They are sequencing facts: treat the benchmark's routed items #1-#3 (write boundary, suggested-
repair text, meta-question routing) as dependencies of presenting chat.html as a general
LLM alternative, and schedule them ahead of, or alongside, the persistence and knowledge-tier
work rather than behind it.

## Part B — the five domain-scoped pages (proposed, not started)

What's actually true today, checked this session rather than assumed — three of the five are
**already seeded with real facts**, not blank slates:

| page | today | proposed |
|---|---|---|
| **spider-fly.html** | Already grounded: `src/domain/spider-fly-world.mjs`'s `worldFactRows()` emits real cell/exit/web/taxonomy facts at session boot. Already zero lazy network requests (CDP-confirmed: 2 requests total, no third parties). | Audit structural-only concepts (vision radius, turn count) for whether each should also be a fact, so a player can ask about it directly. |
| **adventure.html** | Already grounded from `corpus/worlds/src/ashcombe-hall.jsonl` (real subject/predicate/object triples), embedded at build time. One remaining lazy fetch: `sprites-pack/manifest.json` (560 KB) for the large-sprite tier. | Drop the lazy fetch — read the manifest at build time in `build-demo-site.mjs` and embed it directly, the same way this page's own world facts are already embedded. Verified sound this session: the manifest IS the entire large-sprite pack — `scripts/build-demo-sprites-pack.mjs` writes the full template set inline into that one file and nothing else, so embedding it leaves the page with zero runtime fetches. (`PAGE_WEIGHTS.md` describes the manifest as an index into a further per-sprite tier; that description predates the current one-file pack and the measurement record stands as written.) |
| **plan.html** | Already grounded via taught English: `src/domain/hanoi-lesson.mjs`'s `hanoiLessonSentences()` runs real sentences ("disk-1 is smaller than disk-2.") through the same teach path a user's own input uses. One remaining lazy fetch: the wink-nlp CDN import (added this session, Part A). | Drop the CDN dependency — self-host wink through `src/adapters/wink-model.mjs`'s existing `registerWinkModel` seam (built specifically so a bundler-supplied pair works exactly like a CDN-supplied one). The real wire cost is ~3x what this doc's first draft claimed, and the right shape is one shared first-party asset, not an inline copy in each page's own bundle — measured numbers and the revised mechanism in "The wink de-lazying, measured" below. |
| **ledger.html** | Query-only dock over a graph (the demo's own small `public/demo-graph.json`, or a user's real graph via the CLI). One remaining lazy fetch: the wink-nlp CDN import. | Same wink de-lazying as plan.html (the shared-asset shape, not a per-bundle copy). Graph itself stays basic, per the operator — this page's job is to query, not to carry a big corpus. Audit the existing query-template library for phrasing gaps; it's an audit, not a new grammar. |
| **sprites.html** | **No chat dock, no facts, no NLP at all** — a pure visual sprite catalog + a freeform scene-composer text box (`src/services/sprite-catalog-viz.mjs`), with no grounding underneath either. | The one net-new build in this plan: a new pure generator `src/domain/sprite-facts.mjs`, following the `spider-fly-world.mjs` pattern (with one structural difference, named below), walking the parsed sprite template set's class/tier/parameter definitions into real OWL-shaped facts (`<class> rdf:type SpriteClass`, `<class> hasParameter <param>`, etc.). `sprite-catalog-viz.mjs` embeds them at build time (same mechanism adventure.html already uses) and gains a chat dock wired to the same engine, seeded with these facts — no lazy loading, matching every other page in this round. Makes "what classes can you render?" / "what parameters does a person sprite take?" real, fact-grounded answers instead of nonexistent ones. Two costs the first draft left unstated: the dock brings this page its first `*-browser.bundle.js` (~1.6 MB at the other pages' current size, taking the page from 1.2 MB to ~2.8 MB); and the dock needs an explicit wink decision — load the same shared first-party wink asset as the other docks (preferred: a return visitor has already cached it), or run adapter-less on `wink-model.mjs`'s documented null path with a degraded lemma tier. State the choice in the build, don't let it fall out of an import. |

### adventure.html — visual redesign (proposed, not started)

Operator review of the live page (screenshot, 2026-07-21): the current room view is mechanically
correct — real facts render as a chip strip (you/cabinet/desk/lamp, each with a real class badge)
and a single "current room" circle in "THE MANOR, SO FAR" — but reads as a bare functional layout,
not a room. The now-archived `PLAN_GAMES_UPLIFT_V3.md` gave this page one earlier thematic pass (an
"RPG style" note in that plan's origin quotes); this ask is more specific and goes further: get the
`frontend-design` plugin to redesign it toward a **murder-mystery board game crossed with an RPG
stats dashboard** — think Cluedo or Death on the Nile's room-and-suspect-board presentation — with
**90s-RPG-era room-view fidelity, but with better icons** than the current plain circular glyphs.
It doesn't touch what facts the page knows, only how the room, its objects, and the "manor so far"
map present them — the actual design work should invoke the `frontend-design` skill, the same way
the earlier archived pass did.

### spider-fly.html — layout change (proposed, not started)

Operator review of the live page (screenshot, 2026-07-21). Current structure, named against the
real markup in `spider-fly-viz.mjs`: `<div class="stage">` is a two-column grid — `.board-frame`
(the 10x10 canvas board) on the left, `<aside class="side">` on the right holding `.hud` ("agents":
the fly-1/spider-1 status and plan bars) above `.chat` ("tell the spider or the fly something," the
address/chat form and pills) — with `.tuning` (the "live tuning" slider strip: mass loss, spawn
rate, vision, per class) sitting below `.stage` as a separate full-width block at the bottom.

Target layout, top to bottom:
1. A new top row, two columns: `.tuning` on the left at roughly two-thirds width, pinned to the
   top of the page (not the bottom); the chat/agents column on the right at roughly a
   quarter-width (the operator's own stated split — the two fractions leave room for a gutter
   between them, matching `.stage`'s existing `gap`, rather than needing to sum to a full width).
2. Within that right-hand column, swap `.chat` and `.hud`'s order: "tell the spider or the fly
   something" comes first, with `.hud` ("agents") sitting directly below it — the reverse of
   today's order.
3. `.board-frame` (the grid) moves out of the two-column `.stage` entirely and becomes its own
   full-width block below the new top row.

Mechanically this is a markup reorder plus a new grid-column split (a sibling of the existing
`.stage`/`.tuning-grid` CSS grid rules, not a new layout technique) — no change to what the page
knows or how the chat/tuning logic works. Re-run `e2e/pages-spider-fly.test.mjs` and the screenshot
sweep afterward — both already assert this page's structure and would need updating to match the
new order, the same way `pages-home.test.mjs`/`pages-index.test.mjs` were updated for the home-page
rework this session.

**Generator precedent, so the sprites work doesn't invent a new pattern**: this codebase's
established shape for "structured data source → OWL-shaped facts" is a pure generator function
living in `src/domain/*.mjs` (`spider-fly-world.mjs`'s `worldFactRows()`), with a thin
`scripts/gen-*.mjs` wrapper that calls it and writes JSONL into `corpus/*/src/`
(`gen-spider-fly-world.mjs` → `corpus/worlds/src/spider-fly.jsonl`). The sprite-facts generator
should follow this split, not the Wikipedia-dump-specific shape of
`scripts/fetch-reference-pack.mjs`.

The analogy was checked against both modules and holds, with one structural difference to design
to rather than discover mid-build. `spider-fly-world.mjs` is constant-driven: pure with zero
imports, and `worldFactRows()` takes no arguments because the grid constants live in the same
file. The sprite data instead lives in `data/sprites/*.toml` and `data/sprites-large/*.toml`,
parsed by the adapter layer (`readSpriteTemplateFiles` /
`readSpriteLargeTemplateFiles`) — `src/domain/sprite-templates.mjs` itself is a pure resolver
over a template set handed in, it owns no data. So the generator is `spriteFactRows(templates)`:
same purity, but a pure function OVER the parsed template set, with the adapter read living in
the `scripts/gen-*` wrapper (domain stays import-free, matching the layer rules). The facts are
genuinely there to walk: every template carries `classes` (→ `rdf:type` rows),
`parameters.<name>.property` + its `values` map (→ `hasParameter` / allowed-value rows), and
optional `match` tables — and `sprite-templates.mjs`'s `spriteTemplateProblems` already validates
exactly these shapes, so the generator walks pre-validated structure.

One decision the first draft skipped: a committed `corpus/sprites/src/sprite-facts.jsonl` is a
generated artifact whose source of truth (the TOML set) keeps moving, so it needs the same estate
drift guard the ask bundle has (`test/estate/generated-artifacts.test.mjs` is the pattern — and
that guard's own history shows how often a regenerated artifact goes stale mid-session without
one). The alternative is no committed file at all: generate the rows inside `build-demo-site.mjs`
at page-build time, which removes the drift surface but keeps the facts web-only, invisible to
the CLI. Committed-with-guard is the default (it matches the corpus estate's shape and lets a CLI
session load the same facts); either way, name the choice in the build commit.

### The wink de-lazying, measured — the prototype gate is already passed, and it repriced the plan

Before committing ledger+plan to a bundled wink, the substitution was prototyped for real
(2026-07-21, a scratch esbuild build outside the repo, read-only against `node_modules`):

- **The mechanism works.** Both packages are plain CJS with `main` entries only
  (`wink-nlp` → `src/wink-nlp.js`, `wink-eng-lite-web-model` → `dist/model.js`), no `exports`
  maps, and no runtime `fs`/`__dirname` use (the one `fs` reference, in `compile-trex.js`, is
  commented out). A static `import winkNLP from "wink-nlp"` bundles cleanly with the same esbuild
  settings `scripts/lib/browser-bundle.mjs` uses, and the produced IIFE executes:
  `nlp.readDoc("The dogs are running quickly.")` lemmatizes to "the dog be run quickly". No
  loose ends on the bundling question.
- **The first draft's "+1.27 MB" cost figure was ~3x low.** The prototype bundle measures
  4,002,131 bytes unminified (the tier every current bundle ships at — `buildBundle` defaults
  `minify: false`), 3,655,400 minified, 1,027,915 gzipped. The 1.29 MB figure in `PAGE_WEIGHTS.md`
  is esm.sh's *compressed* transfer (CDP measures post-compression bytes; the minified figure
  above lands within 100 bytes of that doc's own uncompressed `curl` measurement, 3,655,472). This
  site's GitLab Pages deployment serves no content-encoding, so inlining wink costs ~3.7-4.0 MB of
  real wire per page — and inlining it into both `ledger-browser.bundle.js` and
  `plan-browser.bundle.js` pays that twice while giving up the cross-page HTTP-cache sharing the
  single CDN URL currently provides.

So the recommendation changes from per-bundle inlining to **one shared first-party wink asset**: a
`scripts/build-wink-vendor.mjs` producing e.g. `public/vendor/wink.js` (esbuild over the two CJS
packages, loaded by the pages' existing import-map/dynamic-import machinery or as a classic script
registering a global), wired through the same `registerWinkModel` seam on every page that wants
the lemma tier — ledger, plan, the sprites dock, and **chat.html/index.html too**, which
currently keep the esm.sh dependency for no reason the goal supports. One cached copy site-wide,
zero third parties anywhere, no per-bundle duplication.

Pair it with **precompressed assets**: GitLab Pages documents serving `.gz`/`.br` variants placed
next to files. Emitting them in `build-demo-site.mjs` for every sizable `.js`/`.json`/`.html`
would cut the wink asset to ~1.0 MB wire and the rest of the site by a similar ratio. This is
documented behavior, not yet verified against this deployment: probe it on the next deploy (the
phasing below names the check) before counting the savings. Compression and the service worker are
not a fallback pair for each other — they solve different problems and both ship this round:
compression shrinks what any single transfer costs, the service worker is what stops a return
visitor paying for that transfer again at all. While in there: the bundles ship unminified today
and nothing depends on their being readable in production, so `minify: true` is a free sibling
lever.

## Part C — package distributions (proposed, lowest priority)

tmct already has a working, proven mechanism for genuinely standalone, downloadable single-file
demo pages, driven from a user's own local repo/memory state: `tmct --render plan --output <path>`
and `tmct viz --output <path>` (ledger) — see `bin/tmct.mjs` lines ~552-601 and ~1062-1087.
`package.json` publishes one CLI/library package (`bin/tmct.mjs`, `src/`); `public/` is a separate
GitLab-Pages-only build, never published to npm — so a literal "new npm package per page" isn't the
natural shape here. The concrete, already-precedented answer: generalize the same
`--render <archetype> --output <path>` mechanism to spider-fly, adventure, and sprites, so all five
non-chat views become downloadable standalone files, not just ledger and plan. Purely additive; do
this last, if at all.

## Phasing for Parts B and C (not started)

1. **The shared wink vendor asset + precompression + the service worker** (the reshaped de-lazying,
   per the measured section above, plus the persistence lever — all three ship together, none
   deferred): build `public/vendor/wink.js`, point ledger/plan — and chat.html/index.html — at it
   through the existing `registerWinkModel` seam; emit `.gz`/`.br` variants in
   `build-demo-site.mjs`; register a service worker precaching the wink asset, chat-seed, and
   reference-pack, treating what it caches as best-effort/volatile (browser storage can be evicted
   or cleared; that's an accepted risk, not a bug to design around — see the service-worker item in
   Part A). The wink prototype gate is already passed (numbers above). Verification this phase owns:
   extend `scripts/post-deploy-smoke.mjs` to fetch one bundle with `Accept-Encoding: br, gzip` and
   assert a `content-encoding` response header (confirms compression actually serves, not just
   builds), and a Playwright check confirming a second page load serves the precached assets from
   the service worker with zero network requests for them.
2. **Adventure manifest embed** — mechanical, verified sound this session (the manifest is the
   whole pack, see the Part B table row).
3. **sprites.html's net-new generator + chat dock** — the one real feature build in this plan.
   Two done-checks, named now so "renders" never gets mistaken for "done": (a) a generator unit
   test asserting every emitted fact's subject/predicate/object traces to a real entry in the
   parsed template set — no minted terms, the same never-guess posture as the resolver itself;
   (b) `e2e/pages-sprites.test.mjs` extended to drive the dock with a canonical question ("what
   parameters does a person sprite take?") asserting the answer names a real parameter from the
   real template data, plus one ungrounded question asserting the miss wall. A dock that has never
   answered one real question from one real fact is not done.
4. Gap-closing audits (spider-fly, adventure, plan vocabulary against their own UI-surfaced
   concepts).
5. The spider-fly layout change and the adventure.html visual redesign — layout/visual builds,
   sequenced alongside the audits since neither touches the same files as phases 1-3.
6. Standalone-export generalization (Part C) — optional, last.

Each phase: `npm run test:fast` + the specific blast radius (the relevant `e2e/pages-*.test.mjs`,
`test/adapters/*-viz.test.mjs`), rebuild via `npm run demo:build`, and a CDP/Playwright check
confirming zero third-party network requests for each de-lazied page — after phase 1 that check
applies to every page on the site, chat.html included. No full `npm test` until a push. Commit per
phase, not one giant commit.

## Non-goals for this doc

- Not an implementation — Parts B and C are proposed work, not executed this session (operator's
  explicit instruction: this document is the deliverable for now).
- Not WordNet-full or live-Wikipedia's wider miss-hook — decided in principle (Part A) but held for
  a future round. The service worker is NOT in this list: it ships in Part B phase 1, not deferred
  (see "Deployment context," near the top of this doc, for why bandwidth/self-hosting cost isn't the
  constraint it might look like elsewhere in this doc's earlier reasoning).
- Not the conversation-benchmark backlog itself (write-boundary narrowing, meta-question routing,
  filler prefixes, silent narrowing) — that work stays routed through `HANDOVER.md`, but Part A
  names where this plan's builds depend on it, and the persistence work should not land ahead of
  the teach-lane narrowing it amplifies.

## Appendix — page weight, measured vs. predicted (2026-07-21)

Nothing in Parts A-C below the "Shipped this session" list is built yet, so these are predictions
against this session's real, measured baseline (`PAGE_WEIGHTS.md`), not new measurements. Where a
number is genuinely unmeasured, it's named as such rather than guessed at.

| page | measured today | predicted on-load after this plan | max growth from lazy loading |
|---|---:|---|---:|
| **chat.html** | 4.41 MB (CDN wink working) | Own doc + bundle + self-hosted wink (~1.0 MB precompressed vs. today's 1.29 MB CDN) puts the non-seed shape at roughly the same order as today. **The WordNet-xl reseed's size is the one real unknown here** — today's 1,264-fact seed is 1.5 MB; the target tier is 72,077 facts (measured via `init:xl` this session), plausibly tens of MB raw before this plan's own boot-budget check and byte-ceiling decision. Don't trust a precise total until that check runs. | Uncapped by design: the reference-pack ceiling is a real 4.32 MB; a future live-Wikipedia fallback adds more, bounded by session length and Wikipedia's 200 req/min limit, not a fixed byte cap the way the reference pack has one. |
| **index.html** | 7.48 MB — stale, measured before the home-page rework removed the live chat embed | Screenshot/link content (small) + the still-separate "ask it about a codebase" demo (~775 KB unbundled modules + ~60 KB `demo-graph.json`) + shared wink asset (~1.0-1.3 MB) ≈ roughly 1.5-2.2 MB. Needs a fresh CDP pass, not a further estimate. | 0 — no remaining deferred fetch once wink is self-hosted. |
| **ledger.html** | 3.99 MB (CDN wink already working) | ~3.7-4.0 MB, roughly unchanged — self-hosting swaps the CDN transfer for a shared, precompressed, same-origin one at similar or slightly smaller size. | 0 |
| **plan.html** | 2.90 MB (CDN wink already working) | ~2.6-2.9 MB, same logic as ledger. | 0 |
| **spider-fly.html** | 2.19 MB | ~2.2 MB, unchanged — no wink dependency, already zero third-party requests. | 0 |
| **adventure.html** | 2.22 MB | ~2.22 MB, unchanged — the manifest is already counted in this figure; embedding it removes one HTTP request, not bytes. (The visual redesign above changes markup/CSS weight by an amount not yet designed, so not estimated here.) | 0 |
| **sprites.html** | 1.20 MB (no bundle, no chat) | ~2.8 MB without the shared wink asset, ~3.8 MB if it takes wink too (open decision, Part B). | 0 |

Two things worth remembering when this table gets revisited: the wink prototype measured only an
~8.6% size drop from minification (4.00 MB → 3.66 MB) — not the large cut minification sometimes
implies, so don't assume a bigger win from `minify: true` elsewhere either. And the service worker
and precompression change what a *repeat* visit pays, not the on-load figures above, which are
first-visit, cold-cache costs.
