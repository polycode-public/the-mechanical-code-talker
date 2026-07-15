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
  assumed — by running tmct's own deterministic inference/consistency machinery (`src/syllogise.mjs`)
  against both the original and the paraphrase: they must entail the same conclusions, and neither may
  contradict the other sentence-by-sentence..


## What's next (feature-shaped — see `HANDOVER.md` for the current task-level list)

- **`archive/PLAN_BREADTH_FIRST_NLU.md`'s own remaining scope** — all six tracks shipped (entity-tie
  ambiguity, router candidate enrichment, `tmct viz` + its embedded chat panel, template-coverage
  harness, alternates-on-hits, canonical representation for the ask/teach lanes — all now in "Current
  capability surface" above). Two named items are satisfied and closed, per their own track's
  original scope (an explicit operator decision, not a silent drop): (a) canonical representation
  for every OTHER chat lane (conversational, commands, recall, ~78 `chat.mjs` return sites) —
  Track 6's own deliverable was the `canonical` field present on every response (even `null` where
  unpopulated), which is met; full population everywhere was always a bigger, separately-scoped
  follow-on. (b) growing the ACE grammar's free-form coverage past its measured 0/2,949-sentence
  baseline — §6's own stated non-goal was a harness + baseline + first generated batch, not closing
  the gap itself, which is met.
- **`PLAN_ADVENTURE.md`** — a text-adventure architectural stretch: an imperative command grammar,
  mutable turn-by-turn world/player state as ordinary graph nodes (no special player-state store),
  and an NPC turn scheduler. Design-only.
- **`PLAN_SYLLOGIST.md`** — retraction-aware consistency checking under a hard budget and trust
  tiers, the one open piece of the reasoning engine's research horizon. Design-only.
- **`PLAN_HANOI.md` follow-ups** — the plan itself shipped (taught game domains, the chat plan
  lane, `tmct import --file` + the `.tmct/imports/` scaffold, the animated plan page; see its
  implementation addendum). Remaining: river-crossing's two missing frames plus the multi-effect
  interpreter extension, and planner-side consumption of the `taught:` capability records the
  registry bridge now registers.
- **`PLAN_GUESS_NUMBER.md`** — the closed-loop (observe-and-replan) planning domain for the same
  kernels. Design-only.
- **`PLAN_VIZ_LEDGER.md` follow-ups** — phases 1-4 shipped (the ledger explorer, its chat dock,
  the Pages hero, this README pass). Remaining: whether the ledger becomes the default viz
  surface; a `goal` field on `factAnswer`'s returns so the dock can carry the chat's goal line
  (needs operator sign-off — it touches the ask engine); a predicate-cardinality question for
  `findContradictions` (multi-valued `has`/`can` facts group under the same contract as genuine
  disagreements); bundle weight if the ledger page outgrows its measured ~533 KB.
- **`PLAN_CODE.md`** — small JS-function and HTML/CSS-fragment synthesis via a sandboxed headless
  browser (Track 1, program synthesis, already shipped). Blocked on a sandbox dependency decision.
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

**Tier-4: learn-on-miss acquisition**. The strongest
miss signal tmct can emit: lexicon term recognized, query built cleanly, zero matches anywhere — the
question was well-formed and the knowledge is simply absent. Web search on the resolved term → clean
the fetched text into the ACE-OWL controlled grammar → store with source provenance → answer the
original question, citing what was just learned. Strictly opt-in, offline default inviolable.
Prerequisites: the provenance-trust policy must extend to `via:"learned:web"`, never silently
blending web-sourced facts with graph/operator facts.

## Design docs

Every substantial design lives in its own `PLAN_*.md` at the repo root (active) or `archive/`
(shipped and closed) — this file points to them, it doesn't repeat their content. `SKILL_*.md` docs
specify the repeatable measurement/build cycles (benchmarks, capability audits, the fast-loop
trap-catching pattern). `HANDOVER.md` is the single current-open-items list.
