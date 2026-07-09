# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative. This file holds only the most
recent completed work and what to do next.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-09)

`npm test` is green at **1371** (1361 + 9 from the concurrent Rule-storage-foundation dispatch,
`src/memory/core.mjs`, item 4 below + 1 from this fix's own new test). v1.0.7 is published; nothing has pushed since, so the local
version stays at 1.0.9 per the bump-at-push-time policy recorded in `CLAUDE.md`. The full
`SKILL_CHAT_PLAYTEST.md` dialogue-flow tier ladder (tiers 0 through 6) is complete.

**INF-C1 fabrication bug (top open follow-up below) is now FIXED.** `GENERAL_VERB_YESNO_RE`'s
no-hit branch (`src/chat.mjs`, was lines 3852-3855) no longer synthesizes a confident "no" when
no taught fact matches the queried triple — it returns `null` (an honest decline), falling
through to the ordinary honest-miss cascade, exactly the fix `INFBENCH_1.2.0.md`/this file's
open-follow-ups list called for. Re-ran `npm run infbench`: chat/INF-C1 goes from `1.2.0`'s
**0% completion / 93% fabrication** back to **93% completion / 0% fabrication** — the same
honest `0.8.2`-era ceiling, restored exactly as predicted (the 2 remaining non-passing rows are
the pre-existing, unrelated "unclear" disambiguation quirk on `-max0-009`/`-014`, unchanged).
Everything else in the ladder is unchanged (still gated at INF-B1, 33% completion, unaffected by
this fix). `test/chat-generalverb-query.test.mjs`'s existing "does margo eat cake" test, which
used to assert the OLD fabricating "no" behavior, now asserts the honest-decline behavior instead;
one new test added for a subject with zero taught facts at all. Everything before this and the
other item below is progress narrative now, and lives in `ROADMAP.md`'s "Where we are
now" section, not here.

## Most recent completed work — start here

### 1. `findActionPath`, a generic bounded state-space search primitive

`src/planning.mjs` (new file, a sibling of `src/syllogise.mjs`, not a change to it) adds
`findActionPath(startState, isGoal, applyActions, { maxDepth })`: a bounded, cycle-safe BFS over a
state space whose successors are generated on demand by a caller-supplied `applyActions(state)`,
instead of looked up in a static edge list the way `findIsaChain` works. It returns the full
action-and-state path, or `null` on an honest miss.

Proven against a small toy graph (5 nodes, a dead end, two cycle edges, a genuine 3-hop
discovery), not against Towers of Hanoi itself. `PLAN_HANOI.md` scoped this as its Phase 2 kernel;
that plan's Phase 3 (the real Hanoi state representation, `legalMoves`, chat-turn wiring) hasn't
started. Nothing is wired into `chat.mjs` yet — zero effect on today's chat behavior.
`test/planning.test.mjs`, 6 new tests.

### 2. INFBENCH re-measured against 1.2.0 — INF-A2 closes to 100%, INF-C1 flips to fabrication

`INFBENCH_1.2.0.md` re-ran the classical-logic ladder. Chat/INF-A2 now closes to a clean 100%,
confirming the proof-chase win already claimed in `PLAN_INFERENCE_TESTING.md`'s status banner.

> **FIXED (2026-07-09, follow-up dispatch).** Chat/INF-C1 had flipped from `0.8.2`'s honest
> 93%-completion near-ceiling to **93% fabrication**. The general-verb-to-predicate query lane
> (`GENERAL_VERB_YESNO_RE`, its no-hit branch, `src/chat.mjs`) answered a confident "no" on
> cardinality queries with no matching taught fact, instead of declining — negation-as-failure,
> exactly what the OWA-honest house ethos forbids everywhere on the inference ladder. Example:
> premise "every scope has exactly 2 flags," query "does every scope have at least 1 flag" used to
> come back a confident wrong "no" instead of an honest "I don't know."
>
> The fix: that no-hit branch now returns `null` (declines) instead of asserting "no", falling
> through to the ordinary honest-miss cascade — same convention as `WHO_OWNS_RE`'s own no-hit
> branch just above it. Re-ran `INFBENCH`: INF-C1 is back to **93% completion / 0% fabrication**,
> its `0.8.2`-era ceiling, exactly as predicted.

### 3. `PLAN_TAUGHT_RELATIONS.md` — design for teaching new relations and rules through chat (research only)

Design doc, nothing implemented. Operator framing: "minimum system wiring, maximum learning
through chat" — ship the smallest possible set of generic teaching-shape recognizers plus a
generic rule store and query dispatcher, with zero hardcoded domain vocabulary (no "grandparent,"
"father," "descendant" anywhere in code). Validated against the classic Prolog family-tree example,
the same way `PLAN_HANOI.md` used Towers of Hanoi.

Six capabilities are scoped: relational fact teaching ("ahab is the father of john"), relation
alias/union ("a father is a kind of parent"), a hop-counted chase over taught relations (reusing
`findActionPath`), property filters, and a recursive-rule reader (needing a new sibling kernel,
`findReachableSet`, since open-ended enumeration with no fixed goal is a shape `findActionPath`
doesn't cover). The doc's own "Phased build order" section sequences all six.

Live-testing against the real CLI while designing this turned up real gaps in already-shipped
code, not just planned work:

- "a father is a kind of parent" (the "kind of" phrasing) reaches no teach recognizer at all today
  — every relevant regex requires a single-token object, and "kind of parent" is three tokens.
- The plain "a father is a parent" phrasing already stores today, but only by accident: "parent" is
  already a lexicon noun (the ordinary "parent class" sense), not because relation aliasing
  generally works. "a father is a grandfather" (neither side in the lexicon) correctly declines
  instead — this exposed which part of the original conversation's design intuition actually held.
- "remember that zorp is florpy" — two fictional words with no relation to anything tmct knows —
  is minted immediately, no decline, no hint. `TEACH_PROPERTY_RE` has no vocabulary or
  groundedness check at all, unlike the newer `unknownSubjectFallback`/`unknownObjectFallback` pair's
  explicit "never mint between two fully ungrounded terms" discipline. A real, already-shipped
  asymmetry, not caused by this design, but one its own item 5 (adjective-mint) must not make worse.

None of this is fixed. It's recorded so a future implementation session (or a tightening pass on
`TEACH_PROPERTY_RE`) starts from the real gaps found live, not the original conversation's
assumptions.

### 4. `PLAN_TAUGHT_RELATIONS.md` Phase 3 — Rule storage foundation (pure plumbing, no `chat.mjs` change)

`src/memory/core.mjs` gained `RULE_CLASS = "Rule"` (added to `recountClasses`'s counted classes),
`appendRule(dir, { name, kind, slots, provenance, createdAt })` (a sibling of `appendFact`, same
load→mutate→write + content-addressed-upsert discipline, over the closed `kind` vocabulary
`compose2`/`filter`/`recursive`), and `findRuleByName(memory, name)` (the future query-dispatcher's
"what kind of thing is X" lookup, proven but not wired to any dispatcher yet). Provenance/trust ride
`syncFactSources`/`recomputeFactTrust` completely unmodified — confirmed neither checks
`individual.class`, and proven with a test showing a Fact and a Rule taught under the same
provenance tag get an identical trust score. New `test/memory-rules.test.mjs`, 9 tests. Zero
`chat.mjs` changes — no new teach-shape recognizers, nothing user-visible yet. See
`PLAN_TAUGHT_RELATIONS.md`'s new "Phase 3 — DONE" note for the two small design gaps resolved
during implementation. Phase 4 (compose2 query-side wiring) is next in that plan's build order.

## Open follow-ups (next session, in priority order)

1. ~~Fix the INF-C1 fabrication bug above.~~ **DONE (2026-07-09)** — see the updated item 2 note
   above; `npm run infbench` confirms INF-C1 back to 93% completion / 0% fabrication.
2. **Judged CHATBENCH re-run.** Not run this session. Onboarding/identity responses, teach-lane
   wording, and new relation phrasings all changed judged-surface answer text, so the next judged
   pass needs to re-derive its stale set from answer-text diffs, not assume anything carries over
   from the 0.8.2-era baseline still on record.
3. **The reverse-`inherits` verb family's "the"-definite forms** ("is the superclass of") aren't
   wired into `VERB_TO_KIND` yet — doing so leaked the bare word "the" into `ask.mjs`'s
   CONTENT_VOCAB and broke the noise-strip tests. Needs a CONTENT_VOCAB fix first.
4. **Seonix Batch 4/5's remaining items**: cochange phrasing variants, and a single, not
   independently reverified "multi-root" substring over-match seen once during that triage.
5. **Extend compound-symbol matching to `/describe`'s own resolver.** The compound-name resolution
   shipped this session only covers `resolveObject` (`src/ask.mjs`); `/describe`'s own resolver
   (`resolveSymbol` in `codegraph.mjs`) is separate, stricter, and doesn't share `resolveObject`'s
   tiered scoring. Not a regression, just not yet covered.
6. **`PLAN_TAUGHT_RELATIONS.md` implementation.** Design is done (above); Phase 1 (relational fact
   teaching plus the adjective-mint groundedness tightening) is the cheapest, most independent
   starting point.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions; that discipline has proven
necessary in practice, not just theoretical caution. Background agents get push permission only
when the coordinator isn't deliberately holding a version-bump commit back — a past near-miss swept
one into a push it shouldn't have, so the coordinator now pushes manually rather than delegating
it. No LLM in the product path, ever.

*Prior sessions' detailed handover (phases 0-11, releases 0.2.0 → 1.0.7) lives in this file's git
history plus the `CHATBENCH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`archive/PLAN_*` artifacts. `ROADMAP.md`'s
"Where we are now" holds the fuller progress narrative for everything shipped before the three
items above.*
