# PLAN_DEPENDENCY_STRATEGY.md — audit the libraries before building on them

A pre-Phase-5 strategic review (operator, 2026-07-05). Before the cycle-4 tuning arc and the
feature phases (6–9) build on the current substrate, audit what tmct depends on, what it
home-grows, and what the modern JS ecosystem offers — so any "switch now" lands *before* features
are poured on top, not as a mid-arc migration. Three background researchers ran: a demand-side
audit (what the phase plans need + what we already have) and two supply-side sweeps (NLP/RDF/
reasoning; infrastructure + ecosystem families). This plan is their synthesis and the standing
decision register.

## Context — what tmct depends on today

Five runtime deps, all **MIT**, all current, none native: `ink ^7` + `react ^19` (the TUI),
`smol-toml ^1.7` (config + data), `wink-nlp ^2.4` + `wink-eng-lite-web-model ^1.8` (the NLP
substrate). One dev dep, `ink-testing-library`. Tarball: **364 kB packed / 2.1 MB unpacked** —
already at the tier-1 budget ceiling, dominated by the ~1 MB (gzipped) wink model. The tree-sitter
/ TypeScript / cytoscape / MCP-sdk deps were all removed in the Phase-0 reshape; do not resurrect.

The constraints that govern every verdict below: **pure JS, ESM, Node ≥24 AND browser-capable**
(Phase 8 browser mode — no native/N-API deps ever on the product path); **permissive license**
(MIT/BSD/Apache/ISC — MPL-2.0 can consume these; flag GPL/AGPL/LGPL/EPL); **offline/$0 hot path**;
**~2 MB tarball budget**.

## Why now, and the headline finding

**The counterintuitive result: change nothing in `dependencies` today.** Every current pick is
the modern-correct choice, and every "should we adopt a library?" question for our home-grown code
resolves to *keep the home-grown code* — because in each case the home-grown version encodes a
**hard tmct requirement the library would weaken**: fail-loud slot templates, cross-version-stable
*synchronous* *browser* content-address ids, transposition-aware fuzzy matching with tie-refusal,
and tuned deterministic ranking. This is not conservatism for its own sake; it is the honesty and
determinism ethos reaching down into the dependency layer. The audit's real product is therefore
not a shopping list — it is (a) a **pre-cleared on-demand adoption register** so future phases
don't re-litigate, (b) a **do-not-touch list** protecting the good home-grown code, (c) an
**avoid list** naming the ecosystem traps, and (d) two genuine near-term actions.

## The two genuine actions (near-term)

1. **Fix the wink browser-loader gap (Phase 8 blocker, not a dep change).** wink's *model* is the
   browser build, but our adapters load it via `createRequire(import.meta.url)`
   (`ask-nlp.mjs:29`, `prose-nlp.mjs:31`) — Node-only. Browser mode needs a bundler `import`
   path. Budget this into `PLAN_REPOSITORY_INTERFACE.md`'s browser-mode work; the "wink is
   literally the browser build" claim is true of the model, not yet of our wiring.
2. **Single-source the fnv1a hash.** Keep the 8-line FNV-1a (see below) but extract it to one
   `src/hash.mjs` so the content-address contract has a single definition. No dependency.

## Do-not-touch — home-grown code that is correct *because* it is ours

Both supply researchers converged here (the infra sweep argued it hardest):

- **`fnv1a` content-address hash** (`memory/core.mjs`). Fact ids must be **stable across tmct
  versions, synchronous, and browser-safe**. Every candidate fails one: `node:crypto` sync API
  isn't browser-portable; `SubtleCrypto` is async (would poison `appendFact` into a promise
  chain); `ohash` doesn't guarantee cross-major-version output stability; `hash-wasm` drags WASM.
  **Keep.**
- **Strict-slot template renderer** (`corpus/templates.mjs`). Its strictness — throw on missing
  slot, never emit a half-filled sentence — is the feature, and it is the opposite of
  mustache's silent-blank. Growing template *libraries* (Phase 6) is a **data** scaling problem
  (more `responses.jsonl` rows), not an **engine** problem. A real engine also can't see that a
  slot is a protected technical span (`PLAN_RESPONSE_FINISHING` segmentation) — it would *hurt*.
  **Keep.** (`eta` is the pre-cleared pick *if* a template ever needs real control flow.)
- **Bounded Damerau-Levenshtein + tie-refusal** (`interpret/fuzzy.mjs`). The modern libs
  (`fastest-levenshtein`, `leven`) are plain Levenshtein — **no transpositions** ("teh"→"the"),
  and none carry the curated-vocab coupling + honest tie-refusal. **Keep.**
- **PageRank + IDF/proximity ranking** (`memory/blocks.mjs`, `codegraph.mjs`). ~40 lines, tuned,
  deterministic, browser-safe. `graphology` would mean marshalling the entities payload into
  `Graph` objects on every scoring pass to regain a PageRank we already have — and the
  IDF-weighted component-aware proximity scorer is bespoke domain logic graphology doesn't
  provide. **Keep** (graphology pre-cleared for on-demand — see register).

## The pre-cleared adoption register (adopt on demand, one package at a time, never as frameworks)

These are vetted against the constraints NOW so the phase that needs them adopts without a fresh
review. Each is MIT, ESM, browser-safe, low-lock-in:

| Need (phase) | Adopt | Notes |
|---|---|---|
| a/an selection + pluralization/agreement (Phase 7 grammar pass) | **`inflection`** (3.x, MIT, fresh, 0 deps) OR a ~5-line vowel-sound heuristic + exception list | **Resolved tension:** do NOT adopt `compromise` for this — it is a *second* NLP family overlapping wink (double model weight, divergent tokenization). A tiny standalone inflection lib, or hand-rolled a/an, respects "one NLP family." |
| OWL 2 RL forward-chaining (Phase 9 speculative + tier-5 Syllogist) | **`eyereasoner` (EYE JS)** — the only alive, browser-capable general reasoner (N3 rules, fwd+bwd chaining, WASM) | **Feature-gated** behind tier-5 — its 1.8 MB SWI-Prolog WASM must never enter the base bundle. Lightweight native-JS fallback: `hylar-core` (93 KB OWL 2 RL, ~2yr stale). A hand-rolled semi-naive datalog over the JSON graph is the license-clean minimal option. |
| RDF serialization / interchange (Phase 8 interface, tier-4/5) | **`N3.js`** (2.x, MIT, ESM browser build, 2 deps) — Turtle/N-Quads I/O + the RDFJS quad shape at the boundary | Keep JSON as the source of truth; borrow N3 only at the I/O edge. Do NOT adopt the quad store as primary rep unless SPARQL becomes central. |
| Graph algorithms beyond PageRank (community/betweenness/layout, if ever) | **`graphology` + the one `graphology-metrics` subpackage needed** | Adopt the family incrementally only when a need beyond the home-grown rank appears. |
| Prose-quality linting of tmct's OWN output (Phase 7, optional) | **`retext`/`unified`** collective (ESM-only, composable) | Only for prose checks wink doesn't do; never duplicate wink's tokenization with it. |
| Template control flow (Phase 6, only if needed) | **`eta`** (4.x, MIT, ~3 KB, custom delimiters keep `{slot}` semantics) | Until a template needs conditionals/partials, the home-grown filler stays. |

## The avoid list — the Eclipse-parser traps (the operator's Java analogy, answered for JS)

- **Comunica** (SPARQL) — 194–260 transitive deps behind an all-or-nothing actor framework.
  *This is the Java/Eclipse-parser trap realized.* Never for a 2 MB product; use N3.Store queries
  or a tiny custom matcher.
- **A second NLP family alongside wink** (`compromise`, `natural`) — running two ecosystems means
  double model weight and divergent tokenizations. wink is the committed anchor; reach into its
  own (stale-but-stable, zero-external-dep) satellites for gaps, not a rival family.
- **Any model-weight NLP** (`transformers.js`, spaCy-wasm) — 100s of MB of weights; violates
  $0/offline/small outright.
- **`blessed`/`neo-blessed`** for new TUI work — dated, CJS, heavy.
- **Abandoned/superseded relics**: `@iarna/toml` (6yr), `object-hash`, `string-similarity`
  (author-deprecated), original `hylar`/`mangle` (dead), `rdflib.js` (prefer N3).
- **License flag**: `datascript` (excellent browser Datalog) is **EPL-1.0**, outside the
  permissive whitelist — escalate to the operator before any adoption.

## Ecosystem-families verdict (commit vs on-demand)

**Commit (anchor):** the **wink family** — already in, MIT, zero-external-dep-per-package, one
doc model, Node+browser. Its cost is the ~1 MB model (the dominant tarball line — protect the
budget against *that*, not against adding small deps). **On-demand, pre-cleared:** unjs
micro-utilities (per-utility), graphology (graph), unified/retext (prose finishing), rdfjs/N3
(RDF interchange), eyereasoner (reasoning). All composable, low-lock-in, adopted a package at a
time. **The strategic rule: one anchor NLP family, everything else borrowed at the boundary when
a phase actually needs it.**

## Publish-not-replace candidates (tmct code worth open-sourcing)

Where our code is arguably *better* than the generic library because of tmct's discipline, the
move is to publish, not replace — MPL-2.0 is share-friendly:

- **`grammar/ace.mjs`** — a pure-JS ESM ACE-OWL controlled-grammar → OWL-triples parser. Rare
  (the reference APE is GPL + SWI-Prolog — disqualified for us on both license and native), and
  genuinely reusable. **Strongest candidate.**
- **`interpret/fuzzy.mjs`** — bounded-Damerau-with-tie-refusal.
- **`memory/blocks.mjs`** — the PageRank + IDF block ranker.

(Publishing is a Phase-8+ nicety, gated on the Repository Interface library-surface work; noted
here so it isn't forgotten.)

## Sequencing

This plan runs **before `PLAN_CYCLE_4.md`** only in the sense that its *conclusions* gate the
feature phases — and its conclusion is "no dep changes needed now," so it does **not** block the
cycle-4 tuning arc from starting. The two near-term actions (wink browser-loader fix,
fnv1a single-source) attach to Phase 8 and a trivial refactor respectively. The register and
avoid-list are standing references for Phases 6–9.

## Open questions

- Does the ~1 MB wink model eventually force a **tier-2 split** (ship a smaller core model, fetch
  the full one at seed time like the corpus tiering)? The budget pressure is real and grows.
- When tier-5 lands, is the 1.8 MB EYE WASM acceptable even feature-gated, or does the
  license-clean hand-rolled datalog win on weight despite covering less OWL semantics?
- Does adopting the RDFJS quad shape at the I/O boundary (N3.js) create pressure to make it the
  primary graph rep over time — and is that drift we want (standards alignment) or resist
  (JSON ergonomics + the provider adapter's shape)? Ties to `PLAN_REPOSITORY_INTERFACE.md`.
