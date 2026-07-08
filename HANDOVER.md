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

### A new benchmark: infbench, now with stages 0-2 shipped

`infbench/` is `PLAN_INFERENCE_TESTING.md`'s 6-band classical-logic ladder (INF-A1 through C2),
mirroring agentbench's shape, mechanically generated cases. 199 cases, first baseline in
`INFBENCH_0.8.2.md`. **The cax-sco gap is closed**: the `deriveTypePropagation` rule
(`src/syllogise.mjs`) plus a live, bounded proof-chain chase (`findIsaChain`/`renderIsaChain`,
`src/chat.mjs`) took chat-A2 from 50% to **100%, 0% fabrication**. Deliberately scoped narrow
(2-hop cap, taught/entailed facts only) specifically to avoid two real regressions found during
the work: an unbounded chase would have accidentally "solved" INF-B2's pinned multi-hop ceiling
cases (miscounted as fabrication against a declared ceiling), and an unfiltered chase found a
genuine corpus-coincidence fabrication (a seeded ConceptNet/SEON fact chain happened to "prove"
an unrelated synthetic test case) — both closed by the scoping, not worked around. B1 still sits
at 33% and gates the ladder (the disjointness proof rule doesn't exist yet); C1/C2 sit at their
honest ceiling. This is the plan working as designed.

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

1. **Bug 8 — FIXED (cluster B, commit `99dfa06`).** The goal-reasoner's global-mode deduction now
   gates on the request ITSELF, not just the caller's declared toolset: a new domain gate reuses
   `ask.mjs`'s own `parseQuery` (the same grammar the C1 resolver already parses every request
   with) to check the request parses to a shape naming the candidate rule's declared `focusClass`
   — zero new keyword tables, "deduction not keyword-match" stays intact. "write a haiku about
   pizza" now honestly refuses instead of confidently answering "biggest testing risk"; the
   previously-working global keystone case (`demo/agentic-loop-demo.mjs`) is unchanged.
   AGENTBENCH goal-driver baseline unchanged (100% plan / 98% result / 0% hallucination, 56
   cases) — independently re-verified by the coordinator, not just the fixing agent's own report.
2. **Bug 6 — FIXED (cluster A, commit `7a4f38c`).** Root cause: a bare directory term
   ("src/lib") had no exact node of its own, so `resolveObject`'s fuzzy tiers landed it on ONE
   arbitrarily-chosen module whose label merely *contained* the path as a substring, then
   traversed only that module's own membership edges (which a module never has) — a false
   empty even with real modules under the directory. Fixed with a directory-prefix scope branch
   (proper path-segment matching, never a bare substring) that unions across every module under
   the directory when there's no exact single-node match. Independently re-verified live.
3. **Bug 7 — FIXED (cluster A, commit `c48c5af`).** Added the modal-auxiliary family
   (should/would/could/can/will/shall/might/must) to `STOPWORDS`, same mechanism as the
   frequency-adverb fix. Independently re-verified live.
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
   - **2 new findings from codememory's dogfooding, not yet triaged**: a typo-tolerance gap on
     the question word itself ("wht other files does X pull in" — "wht" not recognized/stripped
     as "what", the whole phrase becomes a literal search term); and an edge-counting gap ("how
     many tests cover X" can't be answered — the counting grammar only counts entity classes,
     not edges of a named predicate, though it degrades honestly rather than walling).
5. **`PLAN_CODE.md` Track 1 — SIGNED OFF and SHIPPED (cluster D).** GOAL_RULE/PHRASING_FRAMES
   synthesis (`synthbench/`), all 5 staged units. Merged with a real conflict against Bug 8's
   domain gate (both touch `goalReason`) — resolved by hand, both independently re-verified
   working together post-merge. Tracks 2–4 (mutation search, JS, HTML/CSS synthesis) remain
   unsigned-off and untouched.
6. **Chat-feel residual trio — triaged (cluster A):**
   1. Recall half-match replay: **confirmed already fixed** this session (entity∧predicate
      conjunction, pinned tests cover the exact "who owns X" scenario). No change needed.
   2. **The orientation-repeat gap — FIXED (commit `4465120`).** `metaLane`'s `META_ORIENT_RE`
      branch ("what does this app do") was a separate route to the same full-blurb text that
      never got Bug B1's repeat-suppression treatment. Now threads `last` and collapses to a
      one-liner on repeat, same pattern, independently re-verified live.
   3. **Function-grain coverage contradiction — genuine, unfixed, newly precise repro found.**
      `traverse()`'s grain-aware resolution (Bug C+D) only runs on the `"reverse"` shape; the
      `"forward"` shape returns earlier and never reaches it — "what does foo define" over a
      same-stem Module/Class pair resolves the wrong grain, false-empty. Needs a
      `kindSubjectClass` helper (mirrors `kindObjectClass` over edge subjects) and touches
      `traverse()`'s control flow across multiple shapes — bigger than a routing tweak, deferred.
7. **Track-1 trio — mostly FIXED (cluster C, commits `2525e08`, `62e26cb`).**
   - **Pronoun/focus binding: fully cleared.** Root cause was NOT the "it→Commit" mis-bind
     (already fixed in 0.8.2) but a second bug: `isConversational()` is a text-only heuristic
     that fired AFTER `ask()` had already parsed a pronoun-shortened follow-up ("who touched
     it") into a real structural query, discarding the correct composed answer for the generic
     orientation wall. Fixed by gating that branch on `!envelope?.parsed`. B1 pronoun-binding
     34/50 → 50/50, 0 frontier; A2 sibling `g-a2-pron-20` also flipped. Independently
     re-verified live.
   - **Discourse-count: confirmed already green**, 25/25, no fix needed.
   - **Temporal: partially cleared.** Fixed the cochange sub-cluster (6 of 14 red ids): bare
     "changed together with" was missing from the verb table (fell through to "touch(ed)",
     structurally unable to match), and cochange is symmetric but stored as one directed edge
     per pair, so a query naming the stored-subject side found nothing — added a symmetric
     union. B1 temporal 45/50 → 48/50, C1 temporal 41/50 → 44/50. Independently re-verified
     live. Remaining 8 red ids are 7 distinct small grammar gaps (not one shared mechanism —
     "cochange partners of X" unparsed, "the commit history of X" unparsed, "has X changed"
     misparsed as "defines", no superlative-over-commits capability, "before/since \<date\>"
     qualifiers ignored) — deferred, not bundled to avoid scope creep.
   - **New finding, out of this item's scope, not fixed**: `C1:presupposition` (11/25) and
     `C2:garden-path` (12/25) show real hard fails not marked `baselineFail` in the committed
     graded pool — a live, un-flagged regression from some point before this session started.
     Worth investigating next tick.
8. **Perf at monorepo scale — partially done (cluster A, commit `36887ef`).** `edgesOfKind`
   memoized per `(graph, kind)` via `WeakMap`, cache-correctness + perf-sanity tested (≥5x on a
   200k-edge group). The by-subject/by-object endpoint indices are NOT done — would need
   rewiring many existing call sites, judged bigger/riskier than that pass's scope; still open.
   Ontology numeric-vocabulary (stage 3, `PLAN_ontology-hierarchies.md`) turned out to be
   **already done** pre-session (commit `308fa67`) — cluster A found it, no work needed.
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
