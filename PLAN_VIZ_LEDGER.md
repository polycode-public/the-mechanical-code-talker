# PLAN_VIZ_LEDGER.md — a ledger-first memory-graph explorer with an in-browser chat dock

Status: IMPLEMENTED (2026-07-15) — phases 1-4 all shipped: the ledger explorer
(`src/ledger-viz.mjs` + `src/viz-theme.mjs`), the chat dock (with `factReadBack` exported onto the
bundle surface so taught-relation questions answer in-page), the Pages homepage hero
(`scripts/build-demo-memory.mjs` + the `public/index.html` iframe), and the README pass. Later the
same day the ledger was promoted to THE `tmct viz` surface and the node-link page removed — see
"Addendum (2026-07-15, same-day follow-up)" at the end. The body
below is the design record; the risk list at the end carries the implementation deviations
(F1, F2 — both since resolved, see the addendum) and the measured page weight. The design was settled by two clickable mocks built and
operator-reviewed on 2026-07-15 (session artifacts; their decisions are recorded here and in
`PLAN_HANOI.md`'s render section — this document is the system of record, the artifacts are not
linked because artifact URLs rot).

## Origin

2026-07-15 session. The operator asked for an expressive, relevance-first redesign of tmct's
visual surfaces: an interface that shows what is most relevant and lets the user segment and
drill into the data at hand, explicitly not a template. Two mocks were built and approved the
same day: the `plan.html` player (decisions recorded in `PLAN_HANOI.md`, "Render decisions
settled by the 2026-07-15 clickable mock") and a redesigned memory-graph explorer with an
integrated chat dock (this document). The operator also asked that the GitLab Pages site carry
an in-browser chat as part of the redesigned visualization, and then: "yes, please write that up
as a plan, I like all these designs."

## The design, recorded

**Ledger-first inversion.** The primary surface is typeset fact-sentences around one focus term.
The node-link view is demoted to a two-hop minimap. The reason binds to what tmct is: its edges
are sentences, so reading and navigating can be the same gesture. A node picture throws that
away; a ledger keeps it.

**The signature: sentence-as-drilldown.** Fact rows are serif prose with the subject and object
as inline monospace term-chips. Clicking a chip refocuses the ledger on that term and pushes a
breadcrumb. The breadcrumb trail is the drill history; clicking an earlier crumb truncates back.
A search box refocuses on an exact term match.

**Provenance is the only color dimension.** Green = you taught it, slate = corpus, amber =
entailed, rust = disagreement. The same four meanings apply everywhere on the page: row borders,
provenance chips, segment dots, minimap dots. Trust renders as left-border intensity in the
row's provenance color, three tiers. A number would invite false precision; a border reads at a
glance.

**Segments are typed, counted chips**, phrased from the user's side, in three groups:

- **who says so** — provenance (you taught / corpus / entailed)
- **kind of fact** — predicate family (is-a / has / can / used-for / rests-on / role)
- **when learned** — recency bands (today / this week / older), from edge `createdAt`

Facet math: each group's counts are computed against the other groups' active filters.
Zero-count segments grey out. Multi-select within a group.

**"Worth a look" answers relevance before the user asks.** Three computed entries, each a real
refocus link: the newest taught fact, contradictions, and the biggest hub (highest-degree term).
A contradiction renders as two rows inside a rust bracket labeled "more than one answer on
record — shown, never merged", the same contract `findContradictions` (`src/memory/core.mjs`)
already enforces in chat.

**The chat dock: chat and graph are one surface.** An ask-the-graph input sits at the top of the
ledger column. Answers cite their facts with sources, carry the same "Goal (inferred): …" line
chat prints, and focus the ledger on the answered term. A question the engine cannot ground gets
the honest-miss voice with working suggestions. This is the in-browser chat the operator asked
the Pages site to carry.

**The minimap.** A small canvas: focus dot centered, one-hop and two-hop rings, edges as thin
lines, dots tinted by the provenance of their strongest fact, dots dimmed when the active
segments filter them out of the ledger, click-to-refocus, only the focus node labeled.

**Shared identity with the plan.html player.** Both pages draw from one token set. Reference
values (light / dark):

| token   | light     | dark      |
| ------- | --------- | --------- |
| ground  | `#F7F6F2` | `#15181C` |
| ink     | `#23272B` | `#E7E5DF` |
| taught  | `#2E7D4F` | `#5FBE8B` |
| corpus  | `#5A80AC` | `#6C93BF` |
| entailed| `#B07C2E` | `#D9A554` |
| alert   | `#B0503F` | `#D08070` |

Serif prose (Charter/Georgia stack) for sentences and headings; monospace (ui-monospace stack)
for terms, counts, and provenance. Theme-aware via CSS custom properties with
`prefers-color-scheme` plus `data-theme` overrides. Reduced motion respected. Keyboard focus
visible.

**The canonical exchange.** The grandfather chain ("ahab is the father of john … who is the
grandfather of ishmael") is the signature demo moment on every surface: the README's proof
transcript, the ledger's seeded chat turn, the Pages hero. One exchange, everywhere, so the
surfaces read as one product.

## What exists to build on

Verified against code this session:

- `src/viz.mjs`'s three-way factoring: `computeVizGraph` (I/O + traversal, `:51`),
  `renderVizHtml` (pure string builder, `:137`), `readAskBundle`/`readMemoryAskBundle`
  (never-throw artifact reads, `:94`/`:106`). `embedJson` script-safe inline JSON (`:123`).
  The generated page makes no external requests and works offline.
- The in-browser answer engine already ships. `src/memory-ask-browser-entry.mjs` exposes
  `globalThis.tmctMemoryAsk = { factAnswer, createInMemoryStore, normFactTerm }`; the current
  viz page hands it the embedded payload (`memHandle.payload = PAYLOAD`, `viz.mjs:856-857`) and
  calls `factAnswer(memHandle, query, null, true, {})` (`:913`). The chat dock reuses this
  wiring unchanged.
- Bundles build with esbuild (`scripts/build-ask-bundle.mjs`, `npm run build:ask-bundle`).
- Recency comes from edge `createdAt` / derived `updatedAt` (`CAPABILITIES_1.7.3.md` row 94).
  Trust tiers come from `computeTrust` (`src/memory/trust.mjs:65`). Contradictions come from
  `findContradictions` (`src/memory/core.mjs`).
- The Pages site already runs a real engine in the browser: `scripts/build-demo-site.mjs` copies
  engine source into `public/engine/src/` and the page loads it at runtime; `public/index.html`
  has a live chat demo section (`:109`) and `public/demo-ui.mjs` drives it.

## Phased build

*(Each phase independently committable, `npm test` green throughout.)*

- **Phase 1 — `src/ledger-viz.mjs`.** A sibling renderer to `viz.mjs` with the same three-way
  factoring, wired as `tmct viz --ledger`, writing `ledger.html`. Scope: the ledger,
  segments with facet counts, breadcrumb, search, worth-a-look, minimap. No chat yet. The
  existing `graph.html` renderer keeps working unchanged (it serves code-graph structure work;
  see Non-goals). Exit criterion: teach the grandfather chain through the CLI, run
  `tmct viz --ledger`, and the page renders a correct offline ledger; a test verifies the facet
  counts against `readFactRows` on the same store.
- **Phase 2 — the chat dock.** Wire the bundled `factAnswer` exactly as the current viz panel
  does. Answer-to-focus mapping: resolve the asked term against the payload's terms via
  `normFactTerm`; when no term resolves, answer without refocusing. Exit criterion: teach the
  grandfather chain in the CLI, open `ledger.html`, ask the browser chat "who is the grandfather
  of ishmael" — it answers "ahab" with provenance and the ledger focuses ahab.
- **Phase 3 — Pages homepage rebuild.** The ledger page becomes the hero of
  `public/index.html`, seeded with a curated committed demo payload (the grandfather chain plus
  the corpus animals; add the hanoi-3 facts once `PLAN_HANOI.md` Phase 1R lands). The
  ELIZA/PARRY story and install instructions move below the fold. `build-demo-site.mjs` is
  updated; the existing runtime-engine loading keeps powering the chat. Same tokens as Phase 1.
  Exit criterion: Pages CI builds, and the deployed page's chat answers the canonical exchange
  in-browser.
- **Phase 4 — README typography pass (docs-only).** Shop-window discipline on the README's
  middle: front-load what/try/proof, push method detail to the BENCHMARK docs it already links.
  Transcripts are the README's visual signature; make them consistent, short, and ending on a
  Goal line, with the canonical exchange kept as the hero transcript. Exit criterion: the README
  reads front-to-back in the plain-prose voice; the npm page needs nothing beyond the README it
  already renders.

## Open risks / questions

- **Bundle weight.** The memory-ask bundle links most of `chat.mjs`'s transitive graph
  (`scripts/build-ask-bundle.mjs`'s own note). Budgeted at implementation: the Pages
  `ledger.html` measured ~533 KB (the bundle grew 253→434 KB when `factReadBack` pulled the
  router into its link graph); after the addendum batch (cardinality exemption + the goal
  field) it measures ~561 KB (bundle ~462 KB). Same band. Revisit a slimmer entry only if the
  page outgrows this.
- **F1 — the dock's "Goal (inferred)" line. RESOLVED (2026-07-15 addendum):** at
  implementation the dock omitted the line because `factAnswer`/`factReadBack` returned no goal
  field and the original non-goal forbade chat.mjs changes. The operator signed off on the
  additive change: both readers now return a `goal` field (chat.mjs's `withDeducedGoal` — the
  same table-driven deduction runAsk uses, no new phrasing) and the dock renders it.
- **F2 — the contradiction bracket. RESOLVED (2026-07-15, cardinality exemption shipped):**
  `findContradictions` now exempts multi-valued predicates by cardinality, so multi-valued
  `has`/`can` facts no longer group under the same bracket as genuine disagreements. The
  bracket copy stays "more than one answer on record — shown, never merged": still the honest
  description of what a group is.
- **Payload size on large stores.** `init:xl` stores hold 72k+ facts. Options: bound the
  embedded payload to the focus neighborhood plus a term index, or accept full payload up to a
  size cap. Undecided; Phase 1 can ship with a cap and a printed warning.
- **Answer-to-focus precision.** The mapping is a lightweight term resolve over payload terms.
  It must stay that: a second NL parser in the page would drift from the engine's own parse.
- **Facet-count cost.** Counts are computed over the focus neighborhood only, never the whole
  store. That keeps the math cheap; confirm it also stays correct when the payload is bounded.
- **`color-mix()` browser floor.** Resolved at implementation: the trust borders ship as
  precomputed rgba tints in `src/viz-theme.mjs`; no `color-mix()` anywhere.
- **Contradiction detection.** Resolved at implementation: the page reads `findContradictions`'
  real grouped output (see F2 above for what that contract means for the copy).
- **Where the ledger surface ultimately lives.** Decided — see the addendum: the operator
  promoted it to THE `tmct viz` surface.

## Non-goals (as originally planned — two were reversed by the operator, see the addendum)

- No LLM anywhere. The chat dock is the deterministic bundled engine, the same one the viz page
  ships today.
- ~~The existing node-link renderer stays.~~ Reversed at the 2026-07-15 plan review (addendum).
- The mock's toy chat matcher never ships; Phase 2 wires the real `factAnswer` or nothing.
- ~~No changes to `chat.mjs` or the ask engine.~~ Relaxed for exactly one additive change: the
  `goal` field on `factAnswer`/`factReadBack` returns (addendum; F1 above).

## Addendum (2026-07-15, same-day follow-up)

The operator reviewed the shipped pages and reversed the plan's original "the existing
node-link renderer stays" non-goal — stated at plan review ("Please just drop the node link
page") and reconfirmed when asked directly. Decisions recorded:

- **The ledger explorer is THE `tmct viz` surface.** `tmct viz` (no flags) writes `ledger.html`;
  `--ledger` is accepted as a no-op (it now names the default). The node-link `graph.html`
  renderer is removed: `src/viz.mjs`, its code-graph ask bundle
  (`src/ask-browser-entry.mjs` + `src/ask-browser.bundle.js`), and the node-link-only flags
  (`--depth`, `--hub-degree`, `--edge-kind`) are gone; passing a removed flag exits non-zero
  with a hint naming the ledger's real flags (`--focus`, `--term`, `--limit`, `--output`).
  `scripts/build-ask-bundle.mjs` builds one bundle. The shared page helpers
  (`escapeHtml`/`embedJson`) moved to `src/viz-theme.mjs`; `readMemoryAskBundle` moved to
  `src/ledger-viz.mjs`.
- **The dock's Goal line shipped** (F1 above): the operator signed off on the additive `goal`
  field, populated by the same deduction runAsk's own goal line uses.
- **Page weight** is budgeted at the measured size (~561 KB `public/ledger.html`, ~462 KB
  bundle — the ~533 KB implementation measurement plus the exemption + goal-field batch).
  Revisit a slimmer entry only if the page outgrows this band.
- Code-graph structure work (hubs, import fans, impact spread) is still a different job over
  different data; when a structure surface is wanted again it gets designed on its own terms
  rather than resurrecting the hairball.
