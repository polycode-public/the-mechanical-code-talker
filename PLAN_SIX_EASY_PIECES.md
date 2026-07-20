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
  (held back explicitly, not part of this round).
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

## Part B — the five domain-scoped pages (proposed, not started)

What's actually true today, checked this session rather than assumed — three of the five are
**already seeded with real facts**, not blank slates:

| page | today | proposed |
|---|---|---|
| **spider-fly.html** | Already grounded: `src/domain/spider-fly-world.mjs`'s `worldFactRows()` emits real cell/exit/web/taxonomy facts at session boot. Already zero lazy network requests (CDP-confirmed: 2 requests total, no third parties). | Audit structural-only concepts (vision radius, turn count) for whether each should also be a fact, so a player can ask about it directly. |
| **adventure.html** | Already grounded from `corpus/worlds/src/ashcombe-hall.jsonl` (real subject/predicate/object triples), embedded at build time. One remaining lazy fetch: `sprites-pack/manifest.json` (560 KB) for the large-sprite tier. | Drop the lazy fetch — read the manifest at build time in `build-demo-site.mjs` and embed it directly, the same way this page's own world facts are already embedded. |
| **plan.html** | Already grounded via taught English: `src/domain/hanoi-lesson.mjs`'s `hanoiLessonSentences()` runs real sentences ("disk-1 is smaller than disk-2.") through the same teach path a user's own input uses. One remaining lazy fetch: the wink-nlp CDN import (added this session, Part A). | Drop the lazy fetch — static bundle-time `import` of `wink-nlp`/`wink-eng-lite-web-model` instead of the CDN import map, registered through `src/adapters/wink-model.mjs`'s existing `registerWinkModel` seam (built specifically so a bundler-supplied pair works exactly like a CDN-supplied one). Costs ~+1.27 MB to `plan-browser.bundle.js`, removes the CDN dependency entirely. |
| **ledger.html** | Query-only dock over a graph (the demo's own small `public/demo-graph.json`, or a user's real graph via the CLI). One remaining lazy fetch: the wink-nlp CDN import. | Same wink-nlp de-lazying as plan.html. Graph itself stays basic, per the operator — this page's job is to query, not to carry a big corpus. Audit the existing query-template library for phrasing gaps; it's an audit, not a new grammar. |
| **sprites.html** | **No chat dock, no facts, no NLP at all** — a pure visual sprite catalog + a freeform scene-composer text box (`src/services/sprite-catalog-viz.mjs`), with no grounding underneath either. | The one net-new build in this plan: a new pure generator `src/domain/sprite-facts.mjs`, modeled directly on the existing `spider-fly-world.mjs` pattern, walking `sprite-templates.mjs`'s class/tier/parameter definitions into real OWL-shaped facts (`<class> rdf:type SpriteClass`, `<class> hasParameter <param>`, etc.). A thin `scripts/gen-sprite-facts.mjs` writer mirrors `scripts/gen-spider-fly-world.mjs`, emitting `corpus/sprites/src/sprite-facts.jsonl`. `sprite-catalog-viz.mjs` embeds it at build time (same mechanism adventure.html already uses) and gains a chat dock wired to the same engine, seeded with these facts — no lazy loading, matching every other page in this round. Makes "what classes can you render?" / "what parameters does a person sprite take?" real, fact-grounded answers instead of nonexistent ones. |

**Generator precedent, so the sprites work doesn't invent a new pattern**: this codebase's
established shape for "structured data source → OWL-shaped facts" is a pure generator function
living in `src/domain/*.mjs` (`spider-fly-world.mjs`'s `worldFactRows()`), with a thin
`scripts/gen-*.mjs` wrapper that calls it and writes JSONL into `corpus/*/src/`
(`gen-spider-fly-world.mjs` → `corpus/worlds/src/spider-fly.jsonl`). The sprite-facts generator
should follow this exact split, not the Wikipedia-dump-specific shape of
`scripts/fetch-reference-pack.mjs`.

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

1. De-lazying (ledger, plan, adventure) — mechanical, lowest risk, extends the same
   fully-self-contained resilience property Part A's home-page rework already established.
2. sprites.html's net-new generator + chat dock — the one real feature build in this plan.
3. Gap-closing audits (spider-fly, adventure, plan vocabulary against their own UI-surfaced
   concepts).
4. Standalone-export generalization (Part C) — optional, last.

Each phase: `npm run test:fast` + the specific blast radius (the relevant `e2e/pages-*.test.mjs`,
`test/adapters/*-viz.test.mjs`), rebuild via `npm run demo:build`, and a CDP/Playwright check
confirming zero third-party network requests for each de-lazied page. No full `npm test` until a
push. Commit per phase, not one giant commit.

## Non-goals for this doc

- Not an implementation — Parts B and C are proposed work, not executed this session (operator's
  explicit instruction: this document is the deliverable for now).
- Not a redesign of the visual/mechanical uplift `PLAN_GAMES_UPLIFT_V3.md` already shipped — this
  doc is additive to that one, covering knowledge/graph capability, not layout or sprite art.
- Not WordNet-full, live-Wikipedia's wider miss-hook, or the service worker's actual implementation
  — all decided in principle (Part A) but held for a future round.
