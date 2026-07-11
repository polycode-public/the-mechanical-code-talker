# ROADMAP — tmct's current shape and what's next

Forward-looking at a **feature level**: what tmct is capable of right now, and what's planned next.
No session narrative, no dated diary, no "shipped/DONE" history — that's what git log and the
`archive/`/`BENCHMARK_*.md`/`CAPABILITIES_*.md` records are for. For **task-level** pickup (specific
open items, session-scoped), see `HANDOVER.md` instead — this file doesn't duplicate that list.

## What tmct is

A tolerant, ELIZA/PARRY-style chat surface over a codebase, obsessed with software the way PARRY was
obsessed with the mafia — deterministic, zero-cost, **no LLM anywhere in the product path**. Guides a
user toward precision queries rather than guessing; every answer is grounded, restates every genuine
reading it finds in full, or is an honest miss when nothing grounds it at all.

## Ambition

Declared, forward-looking goals — not yet achieved, stated here so they steer future work instead of
getting silently traded away by inherited caution:

- **Reach for Llama-3-level natural language fluency.** Not by putting an LLM in the product path
  (still permanent, see "Explicitly out of scope") — by growing rich template/surface-realization
  variety, so an answer shape has many valid phrasings instead of one fixed slot-fill.
- **Resolve ambiguity breadth-first, always.** Every genuinely valid reading gets its own real answer
  restated in full, never a bare "could mean X or Y — try rephrasing" punt, bounded only by existing
  clipping/pagination limits. Landed for both ambiguity shapes tmct has: parse-level ties
  (`renderCore`'s real-answer resolution, `CAPABILITIES_1.7.3.md` item 92) and entity-level ties (one
  term matching several real graph individuals — every fuzzy-match tie, every noise-strip alt-object
  collision, `PLAN_BREADTH_FIRST_NLU.md` §1). CEFR-confirmed: `BENCHMARK_CEFR_ENGLISH_1.8.0.md`'s
  `ambiguity`-tagged cell moved 1.438 → 1.875 (+0.437, the largest single-tag move on record), and
  the fix resolved a case pair the `1.7.0` report called permanently unfixable (`am-meta-imports` vs
  `g-a1-naming-9` — same input, previously-incompatible expectations; both now score well against
  one breadth-first answer). A dedicated audit found the two generic top-level bail-out hints
  (`rephraseHint`/`compositionalHint`) are provably unavoidable at their actual miss sites, not
  unwired — nothing left to generalize there.
- **Paraphrase alongside the original, verified, never instead of it.** A surface-realization variant
  sits next to the literal grounded answer, never replacing it, and its accuracy is checked, not
  assumed — by running tmct's own deterministic inference/consistency machinery (`src/syllogise.mjs`)
  against both the original and the paraphrase: they must entail the same conclusions, and neither may
  contradict the other sentence-by-sentence. The paraphrase generator itself stays template/rule-based,
  same as everything else in the product path — the novelty is verifying that variety costs nothing in
  accuracy, not the generation mechanism itself.

These sit alongside, not against, the zero-fabrication discipline: an answer with no grounding is
still an honest miss, and breadth-first resolution means showing every real answer a genuine reading
produces, never inventing one to fill a gap.

## Current capability surface

- **Grammar & parsing** (`src/grammar/`): an ACE-inspired controlled fragment (~8 sentence
  patterns), plus multi-candidate ambiguity resolution — when a sentence has genuinely more than one
  valid reading, every surviving interpretation is surfaced instead of one being guessed
  (`archive/PLAN_DID_YOU_SEE_HER_DUCK.md`).
- **Compositional queries** (`src/ask.mjs`): recursive-descent over relative clauses, boolean
  set-algebra (and/or/but-not), qualifiers, aggregates, superlatives, anaphora. Includes real
  two-hop object-relative composition ("which modules import something that X depends on" —
  `parseNested` → `reverseSet`/`forwardSet`, nesting to depth ≥2), confirmed still working via a
  live-tested example (`TOO_HARD_AUDIT.md` U2) after a stale benchmark write-up called it
  "known-hard territory" — it was always built and tested, just never re-checked.
- **Memory** (`src/memory/`): an OWL-labelled JSON graph on disk. Three persistence backends: flat
  JSON (default), pure in-memory (zero disk I/O), SQLite (cached, incrementally-patched reads).
- **Reasoning** (`src/syllogise.mjs`): an OWL 2 RL-grounded rule ladder (subclass transitivity,
  disjointness, someValuesFrom subsumption, cardinality, consistency checking), plus taught-relation
  rules learned through ordinary chat (alias/union, fixed-hop composition, property-filtered
  composition, recursive/reachability) — none of it hardcoded per domain.
- **Default persona**: a general-knowledge "human-world" vocabulary seeded by default (three size
  tiers, `--persona-size small|medium|large`), sourced from Open English WordNet and Schema.org.
  Code-domain vocabulary (SEON/ConceptNet) is opt-in (`--with-persona code`). Query coverage
  includes forward/reverse CapableOf, reverse-HasA, and reverse-inherits/subClassOf shapes (`"can a
  dog bark"`, `"what has a tail"`, `"what inherits from horse"`) against both corpus-seeded and
  freshly-taught facts.
- **Genuine multi-reading ambiguity resolves and answers, not just describes**: when a sentence has
  two-plus valid readings — whether the ambiguity is in how the sentence PARSES or in which real graph
  ENTITY a term names — tmct traverses and renders each one's real answer inline (not just a one-line
  label), so the same input always reproduces the same full, useful answer.
- **Every answer carries a canonical restatement of what was understood**: an English gloss in tmct's
  own preferred phrasing plus the same fact in a compact, machine-parsable notation
  (`shape(kind, args...)` for a query, `fact(subject, predicate, object)` for a taught fact) —
  landed for the ask/query and teach/assert lanes; other chat lanes (conversational, commands) don't
  have a real canonical form yet.
- **Graph traversal and provenance timestamps extend to the memory graph, now with a real viewer AND
  a live embedded chat**: the hub-avoiding `spiralExpand` walk (previously code-graph/Module-only)
  generalizes to any graph via a caller-supplied class predicate and id-normalizer; edges carry a
  `createdAt` stamp and nodes get a derived `updatedAt`. `tmct viz [--focus <id>] [--output graph.html]`
  renders it as one self-contained, locally-navigable HTML file (pan/zoom, click-to-inspect, a depth
  stepper, per-class visibility filters, no server, no external deps) — `npm run viz -- --output
  graph.html && open graph.html`. The page embeds a real "Ask the graph" chat panel running tmct's
  OWN `ask.mjs` engine client-side (bundled via esbuild, adapter-less — no wink model, ~220KB): a
  query resolves against the full graph and re-centres the view on the answer (focus-follows-answer),
  and a node's class/label are click-to-query affordances.
- **Completions** (`src/completions/`): extractive, multi-sentence answers for broad "how does X
  work" questions, grounded and source-cited — never invents a fact beyond what's retrieved, though
  see "Ambition" above for growing the phrasing variety around what's retrieved.
- **Capability router** (`src/router/`): a deterministic, closed-toolset agentic router behind an
  Anthropic-compatible API — measured by `AGENTBENCH`, not general function-calling. An ambiguous tool
  argument stays an honest refusal (never a guess) but, since every registered capability is
  read-only, now additionally carries each tied candidate's real dispatched result alongside it.
  The C1 resolver defers a ranking/superlative request (a declared `SUPERLATIVE_EXTREMES` cue, e.g.
  "what MOST needs a test") to the C2 goal-reasoner's keystone-argmax arbitration instead of
  half-answering it with a flat unranked list — AGENTBENCH C2 is 11/11, 100% plan- and
  result-complete (`TOO_HARD_AUDIT.md` M2, fixed).
- **Interfaces**: the `tmct` CLI, a documented library `exports` surface, and a Repository Interface
  for downstream consumers (seonix).

Measured state for all of the above: the four `BENCHMARK_<TYPE>_<version>.md` reports
(`AGENT`/`CEFR_ENGLISH`/`CONVERSATION`/`INFERENCE`) and the periodic `CAPABILITIES_<version>.md`
audit — always check the latest-dated one, not this file, for real numbers.

## What's next (feature-shaped — see `HANDOVER.md` for the current task-level list)

- **`PLAN_BREADTH_FIRST_NLU.md`'s own remaining scope** — all six tracks shipped (entity-tie
  ambiguity, router candidate enrichment, `tmct viz` + its embedded chat panel, template-coverage
  harness, alternates-on-hits, canonical representation for the ask/teach lanes — all now in "Current
  capability surface" above). What's left, not yet scoped as their own build: (a) canonical
  representation for every OTHER chat lane (conversational, commands, recall) — ~78 return sites in
  `chat.mjs`, bespoke per-lane logic, no single generalizable helper the way the query lane had; (b)
  growing the ACE grammar's free-form coverage past its measured 0/2,949-sentence baseline against
  real prose (`PLAN_TEMPLATE_COVERAGE.md`) — needs more grammar patterns or vocabulary, real work,
  not a tooling pass; (c) the paraphrase-verified-via-`syllogise.mjs` piece of "Ambition" — not
  started; (d) a real "list/count all X of class Y" query shape for memory-graph classes — live
  testing during the viz chat panel's build confirmed no such shape exists via `ask.mjs` alone (only
  `chat.mjs`'s heavier `factAnswer` cascade has it, out of the browser bundle's scope), so the viz
  panel's class-badge click currently falls back to a real client-side filter + a "where is X
  mentioned" query rather than a true "list all" — a genuine, now-documented gap, not a silent one.
- **`PLAN_TEMPLATE_COVERAGE.md`** — the coverage-harness/generation design from (b) above, including
  the real baseline number and the first 17-row generated batch. Read it before picking up (b).
- **A fresh `CAPABILITIES_1.8.0.md` audit** — `CAPABILITIES_1.7.3.md` is pinned at commit `981c9b2`
  and doesn't cover any of `PLAN_BREADTH_FIRST_NLU.md`'s six tracks; this doc's "Current capability
  surface" above covers them narratively, but no full overlay audit has run since. Not done this
  pass — `BENCHMARK_CEFR_ENGLISH_1.8.0.md` alone was in scope.
- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch: an imperative command grammar,
  mutable turn-by-turn world/player state as ordinary graph nodes (no special player-state store),
  and an NPC turn scheduler. Design-only.
- **`PLAN_SYLLOGIST.md`** — retraction-aware consistency checking under a hard budget and trust
  tiers, the one open piece of the reasoning engine's research horizon. Design-only.
- **`archive/PLAN_CONVERSATION.md` Finding 4** — an anaphoric "SUBJECT verb which N" inheritance
  question misroutes into teach-a-fact; needs a discontiguous verb-frame parser, a POS-aware
  mid-sentence interrogative detector, and a union-kind reverse-question fix. Large, three
  sub-problems, not attempted in a single pass — a concrete first-increment sketch exists
  (`HANDOVER.md`), not an undesignable question.
- **`PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`** — closed-loop and open-loop planning domains for the
  `findActionPath`/`findReachableSet` kernels, both already built and proven but not yet wired to
  either domain. Design-only.
- **`PLAN_CODE.md`** — small JS-function and HTML/CSS-fragment synthesis via a sandboxed headless
  browser (Track 1, program synthesis, already shipped). Blocked on a sandbox dependency decision.
- **`PLAN_AGENTS.md`** — the governing plan for tmct's broader multi-repo arc (marginalia, seonix,
  a pluggable LLM rung for Claude Code/Bedrock/Copilot). Check its own sequencing table for current
  phase status, not this file.
- **`PLAN_VIZ.md`** — visualise the memory graph: a recency-seeded, hub-avoiding spiral walk
  (`spiralExpand`, generalized to the memory graph and now returning per-node `hop`) rendered with a
  pseudo-3D depth effect (older nodes deeper/darker, newer shallower/higher-contrast). Traversal and
  timestamp groundwork (edge `createdAt`, derived `updatedAt`) is done; still design-only: the
  rendering layer, situational-fact seeding (a pre-baked git-history corpus, target-repo `README.md`
  ingestion, session/sessionless invocation metadata), and the code-graph timestamp-provider decision.

## Research horizon

*(2026-07-08 research pass — a direction recorded so it isn't re-discovered from scratch, not a
committed build plan. Nothing below is scheduled.)*

**Before the horizon — known-how, no research risk**, just scheduling: `PLAN_CODE.md` Tracks 2-4
(mutation search/repair, JS/HTML/CSS synthesis — APR and CEGIS are established techniques);
RETE/incremental forward-chaining (`PLAN_SYLLOGIST.md` §2 — Forgy 1982, a citable algorithm not yet
ported); contingent/conformant planning under initial-state uncertainty (Bonet & Geffner 2000,
Hoffmann & Brafman 2006, Petrick & Bacchus 2002 all have working algorithms, none yet applied here).

**After the horizon — genuinely unsolved in the field**, named as real research targets with
citations, not stop signs:
- **The frame problem / relevance realization** (open-world planning boundary). McCarthy & Hayes
  1969 named it; Jaeger, Riedl, Djedovic, Vervaeke & Walsh (2024) argue it may not be algorithmically
  solvable in the general case. Speculative angle: bounded (N+1) goal recognition — recognize
  declared goal 1..N, or reject to an explicit "escalate" class, via parse-shape membership.
- **Bounded, incremental, trust-tiered, retraction-safe justification tracking** — `PLAN_SYLLOGIST.md`
  §3. Doyle's JTMS (1979) and de Kleer's ATMS (1986) solve retraction; DRed/RDFox's Backward-Forward
  solve incremental Datalog maintenance; nobody's published the combination with tmct's
  multi-trust-tier, hard-budget requirement. Speculative angle: an ATMS-lite extension to
  `syllogise.mjs`'s currently-flat provenance tag, sketched but unbuilt.
- **A shared ~2M-word cross-domain ontology** (general-English + technical/scientific/programming).
  Merging collides senses of lexically-shared words (`class`, `cache`, `thread`, `field`, `state`)
  across registers; knowledge-based WSD is real but weaker than supervised/neural WSD (Lesk 1986;
  Raganato, Camacho-Collados & Navigli, EACL 2017). BabelNet proves cross-resource sense merging is
  achievable at scale but solves the cross-*lingual*, not cross-*domain*, axis, and carries a
  non-commercial licence. Speculative angle: mutual disambiguation from already-resolved neighbouring
  terms in tmct's own closed graph (a bounded reading of Gale/Church/Yarowsky's "one sense per
  discourse" regularity) — not published anywhere found for this application. Fresh live instance
  (2026-07-11): `"tail"` (Unix process vs. animal body part) collides under `normFactTerm`'s
  cross-corpus flattening, `src/memory/core.mjs:1109-1134`.

**Tier-4: learn-on-miss acquisition** (a real planned capability, not just research). The strongest
miss signal tmct can emit: lexicon term recognized, query built cleanly, zero matches anywhere — the
question was well-formed and the knowledge is simply absent. Web search on the resolved term → clean
the fetched text into the ACE-OWL controlled grammar → store with source provenance → answer the
original question, citing what was just learned. Strictly opt-in, offline default inviolable.
Prerequisites: the provenance-trust policy must extend to `via:"learned:web"`, never silently
blending web-sourced facts with graph/operator facts.

## Explicitly out of scope

- No AWS, no benchmark rig — a published npm library + CLI with a static GitLab Pages home page only.
- No auto-publish — a version release is gated on a deliberate version-bump commit.
- No MCP server, no LLM in the product path — permanent, not "for now."

## Design docs

Every substantial design lives in its own `PLAN_*.md` at the repo root (active) or `archive/`
(shipped and closed) — this file points to them, it doesn't repeat their content. `SKILL_*.md` docs
specify the repeatable measurement/build cycles (benchmarks, capability audits, the fast-loop
trap-catching pattern). `HANDOVER.md` is the single current-open-items list.
