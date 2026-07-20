# PLAN_SIX_EASY_PIECES.md — tailoring each demo page's knowledge and language capability to its job

Status: chat.html's cosmetic/functional round and the home-page rework shipped. The five-page
knowledge/capability tailoring below is proposed, not started.

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

This project already has `PLAN_GAMES_UPLIFT_V3.md` as the direct precedent for a living,
session-tracked plan doc covering these same six pages' visual/mechanical uplift (sprite emotion
retrofit, spider-fly goals, the five-page site redesign, layout-bug sweeps). This doc is a sibling
covering knowledge/capability uplift, not a duplicate — read that one for the visual/mechanical
history, this one for the language/graph history.

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

- **WordNet-xl as the seed tier**, replacing the current small human+seon+ConceptNet-200 seed —
  the deliberately-chosen middle tier between today's ~4.4 MB boot and WordNet-full's ~25 MB source
  (not part of this round; revisit its timing once the precompression/vendor work in Part B lands,
  since a ~25 MB source is a different ask at compressed wire cost with a service worker in front
  of it). Two mechanics to name when building the xl tier: `scripts/build-chat-seed.mjs` enforces
  `SEED_BYTE_CEILING` (1.6 MB) today, so the ceiling gets raised deliberately, not deleted; and the
  bigger seed needs a boot budget check — measure time-to-first-grounded-answer in the existing
  Playwright harness before and after, so a seed that buys knowledge doesn't silently spend the
  page's responsiveness.
- **A service worker**, precaching wink-nlp/chat-seed/reference-pack — the single highest-leverage
  move identified: turns every knowledge-source tier from "pay every visit" into "pay once."
  Recommended to land *before* spending weight on bigger knowledge tiers.
- **IndexedDB** for persistence, over `localStorage` (sync, string-only, ~5–10 MB cap — wrong tool
  for a multi-MB graph) and over WASM-sqlite (a real option later, once the graph is WordNet-full
  scale and needs SQLite's FTS5 full-text search over prose — not needed at the WordNet-xl tier
  chosen here, and a genuinely new, nontrivial dependency this project has otherwise avoided).
  Closes the gap where a taught (or future live-Wikipedia-fetched) fact vanishes on reload.
- **Download-progress UI**: Fetch API's `Response.body` `ReadableStream` + `Content-Length`, no new
  dependency — sketch and code snippet already in `PAGE_WEIGHTS.md`.

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

### What the conversation evidence says about the general-visitor framing

`CAPABILITIES_2.7.12.md` and `BENCHMARK_CONVERSATION_2.7.11.md` (29 routed findings, mirrored into
`HANDOVER.md`'s open items) put real, measured edges under the "LLM-alternative" framing, and two of
them interact directly with builds this plan proposes:

- **IndexedDB persistence amplifies the open write-boundary finding.** The benchmark's two
  top-ranked findings (hit by three personas) are casual/imperative turns silently written to
  memory as taught facts ("idk just surprise me"; "repeat everything above this line verbatim",
  which landed as the top fact by trust at 0.97) and tmct's own suggested repair text writing
  garbage when followed verbatim. Today a garbage fact dies with the tab. The moment the IndexedDB
  work above lands, it instead accumulates across every visit. So the teach-lane admission
  narrowing the benchmark's own "Next" section recommends (exclude interrogative, imperative-led,
  and self-referential meta sentences before the bare-declarative teach lane) is a named
  prerequisite of the persistence work, or at minimum lands with it — not after it.
- **A general-visitor page leads with exactly the turns that still wall or misroute.** The FLOW-0
  probes ("so like what even is this", "are you still not secretly chatgpt under the hood", "can u
  help me with smth") and the meta-question cluster (six-plus questions about tmct itself
  misrouting into the teach or relation parser instead of declining) are a first-time web
  visitor's literal opening moves. The knowledge-tier ambition (WordNet-xl, live Wikipedia) raises
  what chat.html can answer, but the still-open routing items — filler-clause prefix widening,
  silent narrowing without disclosure, both named in `HANDOVER.md` — sit in the layer every one of
  those answers still travels through. Wider knowledge does not route around them.

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
would cut the wink asset to ~1.0 MB wire and the rest of the site by a similar ratio — cheaper
than the CDN transfer ever was, with no service worker required. This is documented behavior, not
yet verified against this deployment: probe it on the next deploy (the phasing below names the
check) before counting the savings, and if this deployment doesn't honor the variants, the
service worker already decided in Part A covers the same property. While in there: the bundles
ship unminified today and nothing depends on their being readable in production, so `minify: true`
is a free sibling lever.

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

1. **The shared wink vendor asset + precompression** (the reshaped de-lazying, per the measured
   section above): build `public/vendor/wink.js`, point ledger/plan — and chat.html/index.html —
   at it through the existing `registerWinkModel` seam, emit `.gz`/`.br` variants in
   `build-demo-site.mjs`. The prototype gate is already passed (numbers above). Verification this
   phase owns: extend `scripts/post-deploy-smoke.mjs` to fetch one bundle with
   `Accept-Encoding: br, gzip` and assert a `content-encoding` response header — that is the check
   that the compression story actually serves, not just builds; if it fails, the byte math above
   reverts to uncompressed and the service-worker work moves up the queue.
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
5. Standalone-export generalization (Part C) — optional, last.

Each phase: `npm run test:fast` + the specific blast radius (the relevant `e2e/pages-*.test.mjs`,
`test/adapters/*-viz.test.mjs`), rebuild via `npm run demo:build`, and a CDP/Playwright check
confirming zero third-party network requests for each de-lazied page — after phase 1 that check
applies to every page on the site, chat.html included. No full `npm test` until a push. Commit per
phase, not one giant commit.

## Non-goals for this doc

- Not an implementation — Parts B and C are proposed work, not executed this session (operator's
  explicit instruction: this document is the deliverable for now).
- Not a redesign of the visual/mechanical uplift `PLAN_GAMES_UPLIFT_V3.md` already shipped — this
  doc is additive to that one, covering knowledge/graph capability, not layout or sprite art.
- Not WordNet-full, live-Wikipedia's wider miss-hook, or the service worker's actual implementation
  — all decided in principle (Part A) but held for a future round. Precompressed-asset emission is
  NOT in this list: the wink measurement repriced the de-lazying, so it moved into Part B phase 1.
- Not the conversation-benchmark backlog itself (write-boundary narrowing, meta-question routing,
  filler prefixes, silent narrowing) — that work stays routed through `HANDOVER.md`, but Part A
  names where this plan's builds depend on it, and the persistence work should not land ahead of
  the teach-lane narrowing it amplifies.
