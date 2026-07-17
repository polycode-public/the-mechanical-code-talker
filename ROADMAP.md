# ROADMAP — tmct's current shape and what's next

Forward-looking at a **feature level**: what tmct is capable of right now, and what's planned next.
No session narrative, no dated diary, no "shipped/DONE" history — that's what git log and the
`archive/`/`BENCHMARK_*.md`/`CAPABILITIES_*.md` records are for. For **task-level** pickup (specific
open items, session-scoped), see `HANDOVER.md` instead — this file doesn't duplicate that list.

## What tmct is

A tolerant, ELIZA/PARRY-style chat surface over a codebase, obsessed with software the way PARRY was
obsessed with the mafia — deterministic, zero-cost, **no LLM anywhere in the product path**. Guides a
user toward precision queries rather than guessing; every answer is grounded, restates every genuine
reading it finds in full, or is an honest miss when nothing grounds it at all. Its visual surfaces —
the ledger explorer with its in-browser chat (`tmct viz`), the animated plan page
(`chat --prompt … --render blocks`), and the Pages homepage hero — are the same graph read out loud:
same engine, same provenance, no LLM.

## Ambition

Declared, forward-looking goals — not yet achieved, stated here so they steer future work instead of
getting silently traded away by inherited caution:

- **Reach for Llama-3-level natural language fluency.** by growing rich
  template/surface-realization variety, so an answer shape has many valid phrasings instead of one
  fixed slot-fill.
- **Resolve ambiguity breadth-first, always.** Every genuinely valid reading gets its own real answer
  restated in full, never a bare "could mean X or Y — try rephrasing" punt, bounded only by existing
  clipping/pagination limits. L
- **Paraphrase alongside the original, verified, never instead of it.** A surface-realization variant
  sits next to the literal grounded answer, never replacing it, and its accuracy is checked, not
  assumed — by running tmct's own deterministic inference/consistency machinery (`src/domain/syllogise.mjs`)
  against both the original and the paraphrase: they must entail the same conclusions, and neither may
  contradict the other sentence-by-sentence..


## What's next (feature-shaped — see `HANDOVER.md` for the current task-level list)

- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch. Its world-state and
  actions-as-data substrate shipped generically with the planning lane (action rule kinds,
  per-step board snapshots, legal-move enumeration); what remains its own is the imperative
  command grammar ("go north", "take the key"), the NPC turn scheduler, the Ashcombe Hall
  corpus, and the room-look digest.
- **`PLAN_SYLLOGIST.md`** — the reasoning engine's research horizon. The single-justification
  retraction slice shipped (`retractSubClassOf`, justification persistence and cascade across all
  five rules); still open there: the ATMS generalization (alternate justification sets per fact),
  incremental matching (§2), and relevance under budget (§4).
- **`PLAN_GUESS_NUMBER.md`** — closed-loop planning over hidden state (belief-interval bisection,
  thinker-mode secret commitment, observation folding) on top of the shipped planner substrate.
  Design-only.
- **`PLAN_CODE.md`** — small JS-function and HTML/CSS-fragment synthesis, plus goal-directed
  program repair (tests as the goal state, mutation templates as planning actions), via a sandboxed
  headless browser (Track 1, rule/frame synthesis, already shipped). Blocked on a sandbox
  dependency decision.
- **`PLAN_AGENTS.md`** — the governing plan for tmct's broader multi-repo arc (marginalia, seonix,
  a pluggable LLM rung for Claude Code/Bedrock/Copilot). Check its own sequencing table for current
  phase status, not this file.


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
  multi-trust-tier, hard-budget requirement. The JTMS-lite slice shipped (one persisted
  justification per entailed fact, VERIFY-backed retraction, all five rules); the open piece is the
  ATMS generalization — alternate justification SETS per fact (see that doc's 2026-07-15 addendum).
- **A shared ~2M-word cross-domain ontology** (general-English + technical/scientific/programming).
  Merging collides senses of lexically-shared words (`class`, `cache`, `thread`, `field`, `state`)
  across registers; knowledge-based WSD is real but weaker than supervised/neural WSD (Lesk 1986;
  Raganato, Camacho-Collados & Navigli, EACL 2017). BabelNet proves cross-resource sense merging is
  achievable at scale but solves the cross-*lingual*, not cross-*domain*, axis, and carries a
  non-commercial licence. Speculative angle: mutual disambiguation from already-resolved neighbouring
  terms in tmct's own closed graph (a bounded reading of Gale/Church/Yarowsky's "one sense per
  discourse" regularity) — not published anywhere found for this application. Fresh live instance
  (2026-07-11): `"tail"` (Unix process vs. animal body part) collides under `normFactTerm`'s
  cross-corpus flattening, `src/adapters/memory/core.mjs:1109-1134`.

**Tier-4: learn-on-miss acquisition**. The strongest
miss signal tmct can emit: lexicon term recognized, query built cleanly, zero matches anywhere — the
question was well-formed and the knowledge is simply absent. Web search on the resolved term → clean
the fetched text into the ACE-OWL controlled grammar → store with source provenance → answer the
original question, citing what was just learned. Strictly opt-in, offline default inviolable.
Prerequisites: the provenance-trust policy must extend to `via:"learned:web"`, never silently
blending web-sourced facts with graph/operator facts.

## Design docs

Every substantial design lives in its own `PLAN_*.md` at the repo root; `archive/` holds the shipped
and closed ones. This file points to them, it doesn't repeat their content. Each plan states its own
status in its opening lines — read it there, because a status quoted here would rot.

| Plan | What it's for |
| --- | --- |
| [PLAN_ADVENTURE.md](PLAN_ADVENTURE.md) | a text adventure as an architectural stretch: imperative command grammar, NPC turn scheduler, room-look digest |
| [PLAN_AGENTS.md](PLAN_AGENTS.md) | the governing plan for the multi-repo arc (marginalia, seonix, a pluggable LLM rung), with its own phase sequencing |
| [PLAN_BENCHMARK_LADDERS.md](PLAN_BENCHMARK_LADDERS.md) | ladder reform: domain taxonomies for AGENT/INFERENCE, a bounded CONVERSATION ladder, and two new dimensional-uplift tiers per benchmark |
| [PLAN_CHILD_CORPUS.md](PLAN_CHILD_CORPUS.md) | a wider default seed corpus, chosen by age of acquisition |
| [PLAN_CLASS_QUERY.md](PLAN_CLASS_QUERY.md) | "list/count all X of class Y", reconciled against what already shipped |
| [PLAN_CODE.md](PLAN_CODE.md) | program synthesis over tmct's closed DSLs, plus JS/HTML/CSS fragments and goal-directed program repair |
| [PLAN_CONSISTENCY_CHECK.md](PLAN_CONSISTENCY_CHECK.md) | tmct as a consistency service for an LLM tool loop |
| [PLAN_DIALOGUE_ACTS.md](PLAN_DIALOGUE_ACTS.md) | naming tmct's turn types to ISO 24617-2 dialogue acts, deterministically |
| [PLAN_EMBEDDINGS.md](PLAN_EMBEDDINGS.md) | the semantic-similarity axis, and the way back to it |
| [PLAN_GRAPH_SCAN.md](PLAN_GRAPH_SCAN.md) | seed and query cost at `init:xl`/`init:xxl` corpus scale |
| [PLAN_GUESS_NUMBER.md](PLAN_GUESS_NUMBER.md) | closed-loop planning over hidden state, via belief-interval bisection |
| [PLAN_MUD.md](PLAN_MUD.md) | persistent, shared tmct worlds over a `server:` memory backend |
| [PLAN_NLU_BENCHMARKS.md](PLAN_NLU_BENCHMARKS.md) | scoring tmct on the CLINC150 and HWU64 intent sets |
| [PLAN_25_BACKLOG.md](PLAN_25_BACKLOG.md) | the 2.5.0-cycle build order: the routed CONVERSATION backlog, the CEFR/AGENT follow-ups, two parser tails, two verb/test decisions, and the SKOS consumer surface |
| [PLAN_OPEN_ITEMS.md](archive/PLAN_OPEN_ITEMS.md) | delivered — the 2.0.3-cycle build order, archived |
| [PLAN_PARAPHRASE_VERIFICATION.md](PLAN_PARAPHRASE_VERIFICATION.md) | checking a paraphrase against the graph before it prints |
| [PLAN_PURGE.md](archive/PLAN_PURGE.md) | delivered — promoted the load-bearing code, deleted the dead weight, archived |
| [PLAN_REPO_INDEX.md](PLAN_REPO_INDEX.md) | tmct grows its own code parsers, ported from seonix |
| [PLAN_SYLLOGIST.md](PLAN_SYLLOGIST.md) | the reasoning engine's incrementality and retraction horizon |
| [PLAN_SYLLOGIST_EL_DL.md](PLAN_SYLLOGIST_EL_DL.md) | beyond OWL 2 RL: an EL classifier, then a DL tableau prover |

`SKILL_*.md` docs specify the repeatable measurement and build cycles (the benchmarks, the capability
audit, the background strategy advisor, plain-prose writing). `HANDOVER.md` is the single
current-open-items list.
