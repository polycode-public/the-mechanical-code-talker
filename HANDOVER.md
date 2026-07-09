# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative. This file holds only the most
recent completed work and what to do next.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-09)

**`PLAN_TAUGHT_RELATIONS.md` is now FULLY COMPLETE — all six items, and the entire storage +
query-dispatcher build, are done and live.** Item 6 (Phase 6's wiring half — the `recursive` rule
and its reachability-list query, item 9 below) was the last piece outstanding; with it landed,
every one of the plan's own six illustrative capabilities (relational fact teach, relation
alias/union, fixed-hop composition, property-filtered composition, adjective-mint, and
recursive/reachability) works end-to-end over the classic Prolog family-tree validation target the
plan named as its benchmark, with zero hardcoded domain vocabulary anywhere in the engine — every
kinship word in every example was taught in ordinary chat, exactly as the plan's own "Origin"
section framed the goal ("minimum system wiring, maximum learning through chat"). This is a genuinely
significant milestone, not a routine bullet: a from-scratch relation/rule-teaching system, generic
enough to learn an entire Prolog-style family tree (facts, aliases, 2-hop composition, gendered
filtering, and unbounded-depth reachability) purely through natural-language chat turns, with no
per-relation code anywhere.

`npm test` is green at **1400** (1382 baseline — which already included the concurrent
Rule-storage-foundation + `findActionPath`/`findReachableSet` planning.mjs work landing in the same
window as Phase 1 — + 4 from item 7's Phase 2 `PLAN_TAUGHT_RELATIONS.md` dispatch + 5 from item 8's
Phase 4 dispatch + 4 from item 9's Phase 5 `filter`-rule dispatch + 5 from item 10's Phase 6 wiring,
all below). v1.0.7 is published; nothing has pushed since, so the local version
stays ahead of npm per the bump-at-push-time policy recorded in `CLAUDE.md`. The full
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

### 5. `PLAN_TAUGHT_RELATIONS.md` Phase 1 — relational fact teach + adjective-mint (`chat.mjs`)

Item 1 (`RELATION_FACT_TEACH_RE` + a `teachLane` call site, both new): "ahab is the father of john"
mints an ordinary Fact via `generalVerbPredicate` reused verbatim — no new storage shape. Query-side
needed zero new machinery: `"what do you know about ahab"` and `"does ahab father john"` both
already confirm it correctly (`"is ahab the father of john"` does not — a real Phase 2+ gap,
recorded, not built).

Item 5 (`unknownAdjectiveFallback`, a new standalone function tried in `teachLane` right after
`unknownObjectFallback` declines): "the cache is bespoke" / "TaskController is bespoke" mint
`mgx:hasProperty`, gated on subject-side groundedness or a bare Capitalized name. One adjustment
found live: a naive groundedness check alone reopened the pinned "module is banana" regression, so
minting now also requires an explicit "deliberate entity reference" signal (an article, a
capitalized name, or a prior-taught fact) alongside plain lexicon groundedness — see
`PLAN_TAUGHT_RELATIONS.md`'s new "Phase 1 — DONE" note for the full story, including a sharper,
live-confirmed restatement of that doc's own Verification finding 4 (`isConversational`'s ≤3-word
gate pre-empts the teach lane entirely for a short bare sentence, not merely its decline text — a
real cross-cutting risk, still out of scope to fix here).

`test/chat-teach-quantifier.test.mjs`, 6 new tests. `npm test`: 1371 → 1377.

### 6. `PLAN_TAUGHT_RELATIONS.md` Phase 6, KERNEL half only — `findReachableSet` (`src/planning.mjs`)

`findReachableSet(startState, applyActions, { maxDepth, stateKey })`, a sibling of `findActionPath`
in the same file: no `isGoal` at all — every state reachable from `startState` within `maxDepth`
hops is a result (`{ node, path }` per node), not just the first one found. Shares only the
literal-identical frontier-seeding step with `findActionPath` (`seedFrontier`); the main expand
loops stayed independent siblings since their halting/accumulation semantics genuinely differ (see
the new comments in `src/planning.mjs` for the full reasoning). Proven against a toy graph with a
real cycle and a same-length two-path convergence (dedup correctness, not just termination).
`test/planning.test.mjs`, 5 new tests; `findActionPath`'s own 6 existing tests reconfirmed
unaffected. Deliberately KERNEL-ONLY — the WIRING half (`RECURSIVE_RULE_TEACH_RE` + the
query-dispatcher's `recursive` branch) is NOT done; both touch `chat.mjs`, held by a concurrent
dispatch at the time, so wiring is deferred until that file is free. Zero `chat.mjs` changes, zero
effect on chat behavior.

### 7. `PLAN_TAUGHT_RELATIONS.md` Phase 2 — relation alias/union query-side chase — `chat.mjs` (2026-07-09)

Item 1's own query-side gap (Phase 1's live finding: "is ahab the father of john" mis-parsed via
`IS_ADJECTIVE_YESNO_RE`) is now closed, alongside item 2 (relation alias/union query-side chase).
One new recognizer, `RELATION_FACT_YESNO_RE`, tried in `factReadBack` BEFORE `ISA_ASK_RE` gets a
chance at the shape (live-confirmed necessary — the two regexes genuinely overlap on "is ahab a
parent of john", and `ISA_ASK_RE`'s own block always returns, so placement order decides the
winner). One new local helper, `relationFactsFor`, enumerates every stored Fact whose predicate
resolves to a queried relation name either directly or via a taught `rdfs:subClassOf` alias chain
(`findIsaChain` reused completely unmodified over relation-name strings). The "kind of"/"type of"
teach-side fix is a genuine one-liner (`stripKindOf`, alongside the existing `stripYour`). A hit
cites both the direct relational fact and the alias fact that licensed it; a genuine miss (no fact,
no alias) declines honestly. `test/chat-taught-relations.test.mjs` (new file), 4 tests. `npm test`:
1382 → 1386. Phase 4 (item 3's compose2 rule, reusing `relationFactsFor` as its per-hop edge lookup)
is next in this plan's build order — see item 8 below.

### 8. `PLAN_TAUGHT_RELATIONS.md` Phase 4 — fixed-hop compose2 composition rule — `chat.mjs` (2026-07-09)

Item 3 (fixed-hop `compose2` composition rule), a follow-up commit right after item 7 above. New
closed-set teach regex `COMPOSE2_RULE_TEACH_RE` ("a grandparent is a parent of a parent") stores a
`Rule` via the already-landed `appendRule`; query side extends Phase 2's `relAsk` dispatcher with a
third step, reusing `relationFactsFor` unmodified as the hop search's per-hop edge lookup (so a
compose2 rule's base relations are ALSO alias-chased). Reuses `findActionPath`
(`src/planning.mjs`) with a `{ entity, hopsTaken }` state and an EXACT `hopsTaken === 2` goal —
live-verified this hop-counting discipline is load-bearing, not just theoretically prudent: a 1-hop
and a 3-hop path through the SAME father/parent edges both correctly decline "is ahab a grandparent
of X" in the same store where the genuine 2-hop pair resolves yes. Full family-tree chain
live-verified end-to-end via the piped CLI (see `PLAN_TAUGHT_RELATIONS.md`'s "Phase 2 — DONE" /
"Phase 4 — DONE" notes for the full transcript and design detail).
`test/chat-taught-relations.test.mjs` extended with 5 more tests (compose2 storage, hop-counted
positive + BOTH negative hop-count cases, full-chain integration) — 9 total in the file. `npm test`:
1386 → 1391.

### 9. `PLAN_TAUGHT_RELATIONS.md` Phase 5 — property-filtered composition rule (`filter`) — `chat.mjs` (2026-07-09)

Item 4: new closed-set teach regex `FILTER_RULE_TEACH_RE` ("a grandfather is a grandparent who is
male") stores a `Rule` (kind `filter`, reusing the SAME `mgx:ruleBase1` attribute `compose2`'s first
slot already uses, per Phase 3's own resolved convention). Query side required a genuine refactor,
not just a new branch: the Phase 2/4 `relAsk` dispatcher's three inline steps (direct fact, alias
chase, compose2 hop-search) were pulled out into one explicit recursive closure,
`resolveRelationChase(name, subject, object)` — a `filter` rule's base is resolved by the function
CALLING ITSELF, generic over whether the base turns out to be a plain relation (steps i/ii) or
another Rule (step iii's compose2 chase), exactly the genericity §3 always specified but the
original three-branch code hadn't yet been reshaped to actually deliver. A hit requires BOTH the
base chase to resolve AND the subject to carry the taught property (`mgx:hasProperty`, a plain Fact
lookup over the already-loaded `rows`); either failing is an honest decline, and the two failure
modes are tested separately (base fails outright vs. base holds but the property filter correctly
EXCLUDES the candidate). Also live-verified: a `filter` rule whose base is a PLAIN taught relation
(never a compose2 rule at all) resolves identically — the genericity holds, not just for the
family-tree illustration's own two-rule chain.

`test/chat-taught-relations.test.mjs` extended with 4 more tests (filter storage, positive
compose2-base chase, negative "base holds/filter excludes" case, positive plain-relation-base case)
— 13 total in the file. `npm test`: 1391 → 1395. CLI smoke test (`printf 'hi\n/exit\n' | node
bin/tmct.mjs`) still exits 0. Live-verified end-to-end via the piped CLI in a fresh tmpdir (full
family-tree chain + the filter positive/negative cases) — see `PLAN_TAUGHT_RELATIONS.md`'s "Phase 5
— DONE" note for the full transcript.

### 10. `PLAN_TAUGHT_RELATIONS.md` Phase 6 — recursive/reachability rule, WIRING half — `chat.mjs` (2026-07-09)

**This completes the ENTIRE `PLAN_TAUGHT_RELATIONS.md` build — all six items, all storage, all
query dispatch.** Item 6 (recursive rule): new closed-set teach regex `RECURSIVE_RULE_TEACH_RE` ("a
descendant is a parent, or a parent of a descendant") stores a `Rule` (kind `recursive`) via the
already-landed `appendRule`; its own `\1` backreference (the rule's new name must literally recur in
its own recursive-step clause) doubles as the malformed-self-reference guard, so a mismatched attempt
("... or a parent of a robot") simply never matches, no extra runtime validation needed. Query side
is the one genuine KIND-CHANGE among all six items: a new recognizer, `RECURSIVE_LIST_ASK_RE`
("list the descendants of ahab"), dispatches to a new `(a0.5)` block in `factReadBack` — a
REACHABILITY-SET enumeration via `findReachableSet` (`src/planning.mjs`, the kernel half already
shipped a session earlier, reused here completely UNCHANGED), not a yes/no chase, so it's a sibling
of Phase 5's `resolveRelationChase` rather than a fourth branch inside it (mirroring
`findActionPath`/`findReachableSet`'s own sibling relationship at the kernel level — a single-goal
search and a full-set enumeration have irreducibly different halting/result shapes). The search
state's `stateKey` is the entity ALONE (dropping the hop count from cycle/dedup identity, unlike
Phase 4's compose2 chase) — this is what gives "one entry per node, via its shortest derivation" and
is also exactly what makes a genuine cycle in the taught edges terminate safely.

Live-verified, not just asserted: the full six-item family tree end-to-end (facts + alias + compose2
+ filter + recursive, all in one session); cycle safety (two individuals mutually taught as each
other's parent — `list the descendants of adam` returns `eve` only, in well under a second, never a
hang); the malformed self-reference declining honestly with no rule ever stored.

`test/chat-taught-relations.test.mjs` extended with 5 more tests (recursive-rule storage, the
reachability-list positive case, cycle-safety, malformed-self-reference decline, and one
comprehensive ALL-SIX-items integration test) — 18 total in the file. `npm test`: 1395 → 1400. CLI
smoke test still exits 0. See `PLAN_TAUGHT_RELATIONS.md`'s "Phase 6 — DONE" note (and its now-updated
top-of-file status line) for the full transcript and design-vs-plan deviation record.

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
6. ~~`PLAN_TAUGHT_RELATIONS.md` Phase 1 (relational fact teach + adjective-mint).~~ **DONE
   (2026-07-09)** — see item 5 above.
7. ~~`PLAN_TAUGHT_RELATIONS.md` Phase 2 (relation alias/union query-side chase).~~ **DONE
   (2026-07-09)** — see item 7 above.
8. ~~`PLAN_TAUGHT_RELATIONS.md` Phase 4 (item 3's compose2 composition rule).~~ **DONE
   (2026-07-09)** — see item 8 above, reusing Phase 2's own `relationFactsFor` list-builder as its
   per-hop edge lookup.
9. ~~`PLAN_TAUGHT_RELATIONS.md` Phase 5 (item 4's `filter` rule).~~ **DONE (2026-07-09)** — see item
   9 above.
10. ~~`PLAN_TAUGHT_RELATIONS.md` Phase 6 (item 6's `recursive` rule, WIRING half).~~ **DONE
    (2026-07-09)** — see item 10 above. **This was the last outstanding item — the entire
    `PLAN_TAUGHT_RELATIONS.md` six-item scope, and its full storage + query-dispatcher build, is now
    complete.** Nothing remains outstanding from this plan.

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
