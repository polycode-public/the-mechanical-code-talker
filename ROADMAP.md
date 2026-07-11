# ROADMAP — tmct's current shape and what's next

Forward-looking at a **feature level**: what tmct is capable of right now, and what's planned next.
No session narrative, no dated diary, no "shipped/DONE" history — that's what git log and the
`archive/`/`BENCHMARK_*.md`/`CAPABILITIES_*.md` records are for. For **task-level** pickup (specific
open items, session-scoped), see `HANDOVER.md` instead — this file doesn't duplicate that list.

## What tmct is

A tolerant, ELIZA/PARRY-style chat surface over a codebase, obsessed with software the way PARRY was
obsessed with the mafia — deterministic, zero-cost, **no LLM anywhere in the product path**. Guides a
user toward precision queries rather than guessing; every answer is grounded or an honest miss.

## Current capability surface

- **Grammar & parsing** (`src/grammar/`): an ACE-inspired controlled fragment (~8 sentence
  patterns), plus multi-candidate ambiguity resolution — when a sentence has genuinely more than one
  valid reading, every surviving interpretation is surfaced instead of one being guessed
  (`PLAN_DID_YOU_SEE_HER_DUCK.md`).
- **Memory** (`src/memory/`): an OWL-labelled JSON graph on disk. Three persistence backends: flat
  JSON (default), pure in-memory (zero disk I/O), SQLite (cached, incrementally-patched reads).
- **Reasoning** (`src/syllogise.mjs`): an OWL 2 RL-grounded rule ladder (subclass transitivity,
  disjointness, someValuesFrom subsumption, cardinality, consistency checking), plus taught-relation
  rules learned through ordinary chat (alias/union, fixed-hop composition, property-filtered
  composition, recursive/reachability) — none of it hardcoded per domain.
- **Default persona**: a general-knowledge "human-world" vocabulary seeded by default (three size
  tiers, `--persona-size small|medium|large`), sourced from Open English WordNet and Schema.org.
  Code-domain vocabulary (SEON/ConceptNet) is opt-in (`--with-persona code`).
- **Completions** (`src/completions/`): extractive, multi-sentence answers for broad "how does X
  work" questions, grounded and source-cited, never freely generated.
- **Capability router** (`src/router/`): a deterministic, closed-toolset agentic router behind an
  Anthropic-compatible API — measured by `AGENTBENCH`, not general function-calling.
- **Interfaces**: the `tmct` CLI, a documented library `exports` surface, and a Repository Interface
  for downstream consumers (seonix).

Measured state for all of the above: the four `BENCHMARK_<TYPE>_<version>.md` reports
(`AGENT`/`CEFR_ENGLISH`/`CONVERSATION`/`INFERENCE`) and the periodic `CAPABILITIES_<version>.md`
audit — always check the latest-dated one, not this file, for real numbers.

## What's next (feature-shaped — see `HANDOVER.md` for the current task-level list)

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch: an imperative command grammar,
  mutable turn-by-turn world/player state as ordinary graph nodes (no special player-state store),
  and an NPC turn scheduler. Design-only.
- **`PLAN_SYLLOGIST.md`** — retraction-aware consistency checking under a hard budget and trust
  tiers, the one open piece of the reasoning engine's research horizon. Design-only.
- **`PLAN_CONVERSATION.md`** — teaching an "every X is Y" sentence as a property, not always a class,
  when Y is genuinely an adjective. Design-only.
- **`PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`** — closed-loop and open-loop planning domains for the
  `findActionPath`/`findReachableSet` kernels, both already built and proven but not yet wired to
  either domain. Design-only.
- **`PLAN_CODE.md`** — small JS-function and HTML/CSS-fragment synthesis via a sandboxed headless
  browser (Track 1, program synthesis, already shipped). Blocked on a sandbox dependency decision.
- **`PLAN_AGENTS.md`** — the governing plan for tmct's broader multi-repo arc (marginalia, seonix,
  a pluggable LLM rung for Claude Code/Bedrock/Copilot). Check its own sequencing table for current
  phase status, not this file.
- **`PLAN_VIZ.md`** — visualise the memory graph: a recency-seeded, hub-avoiding spiral walk
  (reusing `spiralExpand`, already in `src/codegraph.mjs`) rendered with a pseudo-3D depth effect
  (older nodes deeper/darker, newer shallower/higher-contrast). Also covers real node/property
  `updatedAt` timestamps (currently write-once `createdAt` only) and situational-fact seeding (a
  pre-baked git-history corpus, target-repo `README.md` ingestion, session/sessionless invocation
  metadata). Design-only.

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
  discourse" regularity) — not published anywhere found for this application.

**Tier-4: learn-on-miss acquisition** (a real planned capability, not just research). The strongest
miss signal tmct can emit: lexicon term recognized, query built cleanly, zero matches anywhere — the
question was well-formed and the knowledge is simply absent. Web search on the resolved term → clean
the fetched text into the ACE-OWL controlled grammar → store with source provenance → answer the
original question, citing what was just learned. Strictly opt-in, offline default inviolable.
Prerequisites: the provenance-trust policy must extend to `via:"learned:web"`, never silently
blending web-sourced facts with graph/operator facts.

**Dropped by design, not forgotten**: tone-of-voice adaptation (per-voice synonym substitution over
prose) — tmct's protected-span analysis leaves too little safely-substitutable text once any
technically-significant term is excluded; accuracy outranks helpfulness trickery. Revisit only if a
provably-safe substitutable subset emerges.

## Explicitly out of scope

- No AWS, no benchmark rig — a published npm library + CLI with a static GitLab Pages home page only.
- No auto-publish — a version release is gated on a deliberate version-bump commit.
- No MCP server, no LLM in the product path — permanent, not "for now."

## Design docs

Every substantial design lives in its own `PLAN_*.md` at the repo root (active) or `archive/`
(shipped and closed) — this file points to them, it doesn't repeat their content. `SKILL_*.md` docs
specify the repeatable measurement/build cycles (benchmarks, capability audits, the fast-loop
trap-catching pattern). `HANDOVER.md` is the single current-open-items list.
