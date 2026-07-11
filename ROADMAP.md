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

## Design docs

Every substantial design lives in its own `PLAN_*.md` at the repo root (active) or `archive/`
(shipped and closed) — this file points to them, it doesn't repeat their content. `SKILL_*.md` docs
specify the repeatable measurement/build cycles (benchmarks, capability audits, the fast-loop
trap-catching pattern). `HANDOVER.md` is the single current-open-items list.
