# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative. This file holds only the most
recent completed work and what to do next.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-09)

`npm test` is green at **1361**. v1.0.7 is published; nothing has pushed since, so the local
version stays at 1.0.9 per the bump-at-push-time policy recorded in `CLAUDE.md`. The full
`SKILL_CHAT_PLAYTEST.md` dialogue-flow tier ladder (tiers 0 through 6) is complete. Everything
before the two items below is progress narrative now, and lives in `ROADMAP.md`'s "Where we are
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

> **OPEN BUG, not yet fixed — this is the top priority for next session.** Chat/INF-C1 flipped
> from `0.8.2`'s honest 93%-completion near-ceiling to **93% fabrication**. This session's
> general-verb-to-predicate query lane (`GENERAL_VERB_YESNO_RE`, its no-hit branch at
> `src/chat.mjs:3852-3855`) answers a confident "no" on cardinality queries with no matching taught
> fact, instead of declining. That's negation-as-failure, exactly what the OWA-honest house ethos
> forbids everywhere on the inference ladder ("no" must always be a constructive proof, never an
> absence-of-evidence guess). Example: premise "every scope has exactly 2 flags," query "does every
> scope have at least 1 flag" now comes back a confident wrong "no" instead of an honest "I don't
> know."
>
> **The fix is cheap and needs no new entailment logic**: gate that no-hit branch to decline rather
> than assert "no" when the subject/object pair was never taught under ANY predicate, not just the
> one being queried. This was measurement-only work (`src/chat.mjs` was off-limits to that
> dispatch); the fix itself is still open. Re-run `INFBENCH` after fixing it — it should restore
> INF-C1 to at least its `0.8.2`-era ceiling.

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

## Open follow-ups (next session, in priority order)

1. **Fix the INF-C1 fabrication bug above.** `src/chat.mjs:3852-3855`
   (`GENERAL_VERB_YESNO_RE`'s no-hit branch) needs to decline honestly instead of asserting "no."
   Cheap, well-understood, a real regression from this session's own work — see item 2 above for
   the full detail.
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
