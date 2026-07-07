# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`**: read its
**"Where we are now"** block and **Phase 11** first; this file is the short version.
Session handle (inbox): `mechanic`.

## Where we are (2026-07-07)

A large wave landed on `main` this session. It fixed 5 bugs, shipped a new query feature, turned
two research tracks into real code, built a new inference benchmark, and added 4 new plan docs.
All merged, `npm test` green (**1042**). **Version: 0.9.5, pushed** (0.9.0 → 0.9.5 across this
session — 5 HANDOVER bugs + predicate-find + research plans in 0.9.0, then one shipped fix per
playtest-sprint round; see "Playtest sprint" below).

### Playtest sprint (`SKILL_PLAYTEST_SPRINT.md`), rounds 1–3 of an 8-round run (cap raised from 3
### to 8 mid-run by operator instruction)

- **Round 1** (0.9.3): a redundant same-kind verb after a relation-trigger word polluted object
  extraction ("what tests cover X" — "cover" wasn't stripped); frequency adverbs ("usually" etc.)
  weren't in `STOPWORDS`.
- **Round 2** (0.9.4): polite describe-wrapper phrasings ("can you tell me more about X") dead-ended
  instead of resolving like `/describe X` — added a last-resort rescue lane.
- **Round 3** (0.9.5): the round-2 rescue lane only stripped a LEADING "please", not trailing
  ("...about Router please" still failed); a leading "btw" with no delimiter derailed an otherwise-
  working query into the wrong clause shape — added to `FILLER_WORDS`. Also logged 4 deferred
  findings (likely genuine ceilings, not routing bugs) — see the numbered follow-up list below.
- Rounds 4–8 continuing; results relayed as they land.

### The 5 bugs from the last follow-up list, all fixed

- **Bug A: recall half-match replay + staple-onto-wall.** `bestQaPair` (`src/chat.mjs`) now
  requires entity AND predicate to match, not either alone. A recall answer no longer prepends
  onto a wall.
- **Bug B (4 parts).** B1: the off-topic orientation blurb now shortens on repeat instead of
  reprinting in full. B2: "thanks, `<clause>`" no longer walls. B3: a forward-shape miss no longer
  leaks `reexports` vocabulary into its render. B4: `/describe` now surfaces taught facts.
- **Bug C+D: grain-aware entity resolution** (`src/ask.mjs`). `resolveObject` takes an optional
  `expectedClass`. `traverse` grain-checks and up-refines a symbol-grain object to its containing
  module for tests/cochange queries. This fixes the fuzzy-entity false-empty ("which modules
  import logger" no longer resolves to a same-named class) and the function-grain coverage
  contradiction ("does createTask have tests" now agrees with `/tests createTask`).
- **Bug E: module-grain overview gap.** "what does `<module>` do" now answers, not just the
  app-level version of the question.

### A new feature: predicate-based "find" queries

"find me the payment class" now works: type-filtered, fuzzy property-surface matching, with a
narrow-then-broaden cascade (self and descendants first, then ancestor and siblings if nothing
matches) and a boolean-fold generalization for compositional predicate queries. Design doc:
`archive/PLAN_PREDICATE_QUERIES.md`.

### Research plans that became real code

- **Ontology tracks (a)+(b).** Wired the two synonym resources that existed but were never
  consulted: ConceptNet's `/r/Synonym` and `/r/SimilarTo` rows, and the phrasebook's synonym
  families. Both now feed query-time term matching.
- **Ontology track (d).** Grew the disjointness premise set (`corpus/seon/concepts.jsonl`, 238 to
  280 rows) and added 7 numeric data-property nouns to the lexicon.
- **Advanced-grammar track (a).** Closed-frame subordination and conditional query support
  (`src/interpret/normalize.mjs`).
- **Advanced-grammar track (f).** Presupposition honest-nudges ("why does X still import Y").
- **Advanced-grammar pool growth.** chatbench's graded pool grew from 925 to 1075 cases, across 6
  new construction families: subordination, conditional, ellipsis, discourse-deixis,
  presupposition, garden-path. See `chatbench/GRADED.md`.

### A new benchmark: infbench

`infbench/` is stage 0 of `PLAN_INFERENCE_TESTING.md`: a 6-band classical-logic ladder (INF-A1
through C2), mirroring agentbench's shape, with mechanically generated (not hand-authored) cases.
199 cases, first baseline in `INFBENCH_0.8.2.md`. Measured: kernel A1/A2 clean pass; chat A1 100%;
chat A2 exactly 50% (the cax-sco gap, now measured rather than asserted). B1 sits at 33% and gates
the ladder, because the disjointness proof rule doesn't exist yet. B2/C1/C2 sit at their honest
ceiling because the rules those bands need aren't built. This is the plan working as designed, not
a shortfall.

### A new demo, and the bug it surfaced

`demo/agentic-loop-demo.mjs` runs agentbench's own `createRunCtx`/`goalDriver` as a live
transcript, showing the deduce-plan-execute-compose loop end to end. It also surfaced Bug 8 below.

### Also fixed: a throwing turn no longer kills the session

`session.turn()`/the non-interactive loop had no `try`/`catch`. One bad turn could abort a whole
piped session before its log flushed. Fixed with `try`/`catch` and `try`/`finally`.

### 4 new research-plan docs (root, all cross-linked, all point back to `ROADMAP.md`)

- **`PLAN_ontology-hierarchies.md`.** Replaces the old idea dump. Audits the 3 existing
  synonym/hypernym mechanisms (2 were already wired, 2 sat inert and are now wired). Recommends
  against bulk-importing WordNet: wrong tier, and it would reintroduce the noise the filtered
  corpus was built to avoid.
- **`PLAN_INFERENCE_TESTING.md`.** Revised so infbench case generation is mechanical, not
  hand-authored. It mechanizes the bench, not the engine: new inference rules in
  `src/syllogise.mjs` stay hand-written work, staged for later.
- **`archive/PLAN_PREDICATE_QUERIES.md`.** The find-query feature's design doc.
- **`PLAN_ADVANCED_GRAMMAR.md`.** Gained cross-links to the other plans and a phasing note.
- **`PLAN_CODE.md`.** New, not built. Program synthesis over tmct's own closed DSLs: a
  `GOAL_RULE` or `PHRASING_FRAMES` entry synthesized from labeled examples, plus two later, harder
  tracks (small JS-function synthesis, HTML/CSS-fragment synthesis) via a Playwright-sandboxed
  headless browser. Explicit operator sign-off is required per track before any of it is built.

## Open follow-ups (next session, in priority order)

1. **Bug 8, highest priority: the goal-reasoner answers unrelated requests with confidence.**
   `src/router/goal-reasoner.mjs:226`'s global-mode deduction gates only on the caller's declared
   toolset, never on whether the request text relates to the deduced goal, once no focus entity
   binds. "write a haiku about pizza" gets a confident, well-formatted "biggest testing risk"
   answer instead of an honest refusal. Reproduce with `demo/agentic-loop-demo.mjs`. This is a
   genuine confident-wrong failure in the flagship zero-hallucination capability (AGENTBENCH's C2
   goal-reasoner), more serious than the cosmetic bugs fixed this wave. It needs a real semantic
   gate, not a quick patch.
2. **Bug 6: scoped listing false-empty. Now CONFIRMED locally reproducible** (playtest sprint
   round 4, `examples/mini-webapp`): "list modules in src/lib" and "list files in src/handlers"
   both return "no modules in this index." even though `src/lib/logger.mjs`/`src/lib/http.mjs`
   and `src/handlers/{base,tasks,users}.mjs` genuinely exist. Originally found by an external
   session (codememory) dogfooding a 191k-entity monorepo graph; no longer needs their scale to
   repro — raises this bug's priority, it's now trivially demonstrable and testable in-repo.
3. **Bug 7: a modal survives the fuzzy cascade.** "what should i look at first" gets rewritten to
   "what hold i at". `STOPWORDS` (`src/interpret/normalize.mjs`) has no modal auxiliaries
   (should/would/could/can/will/shall/might/must), so "should" reaches the fuzzy-correction step
   and lands within edit distance of "hold". Diagnosed, not yet fixed: add modals to `STOPWORDS`.
4. **`PLAN_TMCT_ECOSYSTEM_INTEGRATION.md` — landed.** The redispatched research doc is done
   (an earlier attempt was lost to an untraceable context boundary; this is a fresh pass).
   Correction to the note this follow-up used to carry: the `/v1/messages` shim commits
   (`5abc102`, `9f1c505`) are **NOT unmerged stray work** — they're already merged and shipped
   on `main` since 0.8.0 (confirmed via `git merge-base --is-ancestor`); the
   `.claude/worktrees/agent-*` directories are just ordinary leftover worktrees whose commits
   already landed. Bigger finding: **seonix has already fully migrated to tmct** — their
   `PLAN_CHAT_EXTRACTION.md` is archived (= done), they import
   `@polycode-projects/the-mechanical-code-talker@^0.9.4` as a real dependency, and are now
   running their own playtest-sprint-style dogfooding against tmct's chat engine on their real
   production graph (see `~/.claude/inboxes/codememory.md` for live findings). marginalia is
   the one genuinely open part of the plan — see the doc's §3.2.
5. **`PLAN_CODE.md`'s sign-off gate.** Read the plan and decide with the operator whether to
   greenlight Track 1 (GOAL_RULE/PHRASING_FRAMES synthesis). Tracks 2/3 (JS, HTML/CSS synthesis)
   stay further out regardless.
6. **Chat-feel residuals from the 0.8.2 confirmation playtest** (ranked, smaller than 1-3 above):
   1. Recall matching still fires on half-matches once memory fills. Entity OR predicate mismatch
      can replay, and a recall can still staple onto a wall in the who-owns re-ask path.
   2. Function-grain coverage contradiction: any similarly-shaped case not caught by the Bug C+D
      fix above.
   3. The off-topic orientation blurb still doesn't shorten everywhere the parse-wall route does.
7. **Track-1 trio** (pronoun / temporal / discourse-count), deferred with measured targets
   (advisor tick-4, full-pool dry-run): pronoun red set = 18 ids (g-b1-pron
   1,4,5,7,12,13,16,18,20,21,22,28,30,33,35,36,48,50; g-c2-pron unmeasured at full depth);
   temporal = g-b1-temp x5 (7,31,44,46,49) + g-c1-temp x9 (10,12,23,28,29,33,39,47,48).
   Re-measure g-b1-disc-count full-25 first: it sampled 0/5 red at tick-4, likely already green.
8. **Perf at monorepo scale** (advisor tick-4 #1, queued as the first post-release perf lever):
   memoize `edgesOfKind` per (graph, kind) with a `WeakMap`, add by-subject/by-object endpoint
   indices (mirroring `adjacencyForKinds`). No crash-class hazard remains; these are latency/GC
   cliffs on 27k-module graphs.
9. **`test/goal-reasoner.test.mjs` shared-ctx conversion.** Convert to the shared run-ctx pattern
   the runner now uses (hygiene; keeps the suite honest about per-case isolation).
10. **Version bump and push — DONE.** 0.8.2 → 0.9.0 (the main wave) → 0.9.1 → 0.9.2/0.9.3
    (scoped-listing + recall fixes, playtest round 1) → 0.9.4 (playtest round 2) → 0.9.5
    (playtest round 3), all pushed, all publishing via CI. seonix (codememory) pinged and has
    already bumped its own pin through this chain (see `~/.claude/inboxes/codememory.md`).

11. **Playtest sprint findings (round 3, `SKILL_PLAYTEST_SPRINT.md`), deferred as likely genuine
    ceilings — not forced this wave:**
    1. The bare interrogative form of scoped listing ("what modules are in `<dir>`") declines
       even though the imperative form ("list modules in `<dir>`") already works — `parseList`
       (`src/ask.mjs`) deliberately declines any meaningful tail on the interrogative path to
       avoid colliding with genuine reverse-clause predicates ("which modules import X"), and the
       compat tests pin that decline. A real fix needs a narrowly-scoped exception (interrogative
       + a leading scope preposition — "in"/"inside"/"under" — routed the same way the imperative
       form already is) rather than a blanket widening; not attempted this round to avoid
       regressing the pinned reverse-query tests without dedicated time to verify.
    2. "find me the task controller" (a compound proper-noun phrase, no generic type-noun like
       "class"/"module") doesn't match predicate-find's grammar — likely a genuine phrasing
       ceiling, not a routing bug (predicate-find requires a generic entity-type noun by design).
    3. "can you remind me what classes exist" — a listing-style wrapper analogous to the
       describe-wrapper rescue (round 2) but for list/count queries, not describe. Real gap;
       bigger scope than a routing tweak, would need its own closed-frame lane.
    4. "and what about addRoute, what's that for" (anaphoric topic-shift) — already-known,
       already-deferred ADVANCED_GRAMMAR track (b)/(e) territory (DRT-lite discourse). Not a new
       finding, just confirmed still open.

### Bench reuse map (0.8.0–0.8.2 deterministic runs are FROZEN; judged state below)

Deterministic AGENTBENCH/CHATBENCH reproduce byte-identically and are always safe to re-run.
AGENTBENCH has no judge at all. **The judged CHATBENCH is the only expensive part and must never
be blanket-reused across a text change.** Current judged state: **no stale tags carried over from
0.8.2's release.** The 0.8.2 re-judge scored {graph-query, honesty-miss, multi-turn-focus,
memory-recall, ambiguity, conversational, typo-fuzzy, noise} plus the B2/C1 assert cells against
the 0.8.2 tree (`CHATBENCH_0.8.2.md` "Judged re-judge (post-release)"; raw in
`chatbench/results/raw/run-0.8.2/`). bootstrap-empty carries its 0.8.0 score (2.000; surface
untouched since). **This session's wave touches answer text on judged surfaces again**
(find-queries, subordination/conditional parsing, presupposition nudges, synonym matching), so the
next judged pass needs to re-derive its stale set from answer-text diffs the same way the 0.8.2
re-judge did, not assume anything carries over. Not yet run.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every commit;
coordinator + background sub-agents, disjoint file-ownership, worktree-isolated, merged back; a ~5-min
completion-driven **strategy advisor** running throughout; CHATBENCH/AGENTBENCH artifacts match
`package.json` version, `_00N` for re-runs; no LLM in the product path (the CHATBENCH judge lives only
in the eval harness; AGENTBENCH grading is deterministic).

*History (Phases 0–10, releases 0.2.0→0.7.1) lives in git + the `CHATBENCH_*` / `archive/PLAN_*`
artifacts. Phase 11 (0.8.0 → present) is in `CHATBENCH_0.8.*` / `AGENTBENCH_0.8.*` / `INFBENCH_*` /
`STRATEGY_ADVISOR.log` + `PLAN_CHAT_FEEL.md` + `src/router/` + `agentbench/` + `infbench/`.*
