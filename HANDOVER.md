# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
**"Where we are now"** block and **Phase 11** first; this file is the short version.
Session handle (inbox): `mechanic`.

## Where we are (2026-07-07)

- **v0.8.1 PUBLISHED** (npm reads 0.8.1). **v0.8.2 BUILT + GATED GREEN — ship decision taken
  (ship-over-delay); the push is the next operator action** (`package.json` = 0.8.2, local `main`
  ~21 commits ahead of origin; pushing `main` triggers CI publish). `npm test` green (**974**),
  CLI smokes exit 0.
- **0.8.2 = the chat-feel wave + rule-general C2 + the member-filter hop + a live scale hotfix**,
  built as 7 merged workstreams (feel #1–#4, router #1–#3) with the strategy advisor riding
  (findings F1–F12 + tick-4, all adopted/resolved in `STRATEGY_ADVISOR.log`):
  - **Chat (CHATBENCH_0.8.2, deterministic tier):** tier-1 **334/334 (draw A** — pool grew 333→334,
    `gq-forward-method-calls` appended**) + 285/285 (draw B)**, zero regressions all wave. The
    cycle-1 standing hard-fail **`gq-functions-call-fnalpha` flipped green** (grain fallback;
    annotated `improvedIn:"0.8.2"`), and the author lane flipped `g-c1-temp-24/-25` (names Ada
    Lovelace). Landed: recall hygiene (walls never memorized/replayed; fold re-clean heals poisoned
    stores), preamble/politeness frames + determiner dedupe, calls∪callsSymbol +
    Function↔Method grain fallback + Class-individual meta fallback + has-tests→coverage, author
    lane (who is <author> / what did they touch / who authored <sha>), wall kindness (repeat
    suppression, graph-derived examples, "what does the app do" overview, riskiest + opinion +
    imperative + why-untested nudges), teach-lane widening (property + ownership facts, `teach:`
    0.95 trust prior, taught-class↔graph-`inherits` bridge), receipt tails prose→detail
    (recoverable via "why"). Dual-draw agreement 26/30 (0.867, down from 0.933) with 4
    under-covered cells named. A live confirmation playtest greenlit the wave ("materially better
    than baseline"); residuals in follow-up #2.
  - **⚠️ JUDGED TIER DEFERRED (operator: ship-over-delay).** 0.8.1 judged scores remain the judged
    record and are **STALE** on {graph-query, honesty-miss, multi-turn-focus, memory-recall,
    ambiguity, conversational, typo-fuzzy, noise} + graded assert cells until the re-judge lands
    (follow-up #1). See CHATBENCH_0.8.2's deferral section.
  - **Agent (AGENTBENCH_0.8.2):** ladder 43→56 cases (+13 fixture-linted result cases). Goal
    driver **100% plan / 98% result / 0% hallucination, ALL rungs gate-PASS**; the single red
    `ab-c2-what-to-test` is kept deliberately (ranking would need request-keyword memorization).
    Resolver floor **A0–C1 all 100/100** (the member-filter HTN method + per-member hop flipped
    `ab-c1-widget-methods-calling` in BOTH drivers); C2 36%/27% = the deliberate C1-escalation
    ceiling. **Rule-general C2**: second goal-rule `cochange-risk-invariant` + pure
    `applicableRules` selection (0→open-world refuse, >1→ambiguous refuse; grep-clean of request
    keywords). Bench-import inversion (`src/router/call-validator.mjs` + `set-algebra.mjs`; product
    no longer imports from `agentbench/`). Runner has a bounded pool (`--concurrency`, default 8).
    Byte-identity verified twice post-merge. **F9 note** in the doc: 5 refuse rows identical on all
    graded axes vs frozen 0.8.1_002; only `produced.why` text reworded by the generalization.
  - **Scale hotfix:** argument-spread stack overflow in `edgesOfKind` past ~100k edges in one
    relation group — found live on a 27,770-module monorepo (`~/projects/wh`, via seonix). Fixed
    (loop-append) + synthetic ~200k-edge regression test.

## Open follow-ups (next session, in order)

1. **The judged re-judge (first post-release bench action).** Pinned judge
   (`claude-haiku-4-5-20251001` @ `judge-prompt-v1`, 3 samples/case, `--concurrency 12`) over the
   stale tags {graph-query, honesty-miss, multi-turn-focus, memory-recall, ambiguity,
   conversational, typo-fuzzy, noise} + graded assert cells; carry untouched tags; re-derive the
   final list from actual answer-text diffs. Regression watch (advisor F4): `hm-unknown-module` /
   `hm-unknown-fn` — if an honesty cell drops, restore the receipt tail on genuine unknown-entity
   misses only. Artifact: `CHATBENCH_0.8.2_001.md`.
2. **Chat-feel fast-follows (ranked; from the 0.8.2 confirmation playtest — greenlit overall,
   these are the residuals):**
   1. Recall matching still fires on half-matches once memory fills — entity OR predicate mismatch
      can replay, and a recall can still staple onto a wall in the who-owns re-ask path. Enforce
      the predicate+entity CONJUNCTION and never-prepend-to-a-miss fully (~20% of the old severity
      remains).
   2. **NEW confident-wrong class — fuzzy-entity FALSE EMPTY**: "which modules import logger" →
      "No modules found…" although the full-path form answers (bare name doesn't resolve to
      `src/lib/logger.mjs`, and the empty renders as fact). Worse than a wall; fix resolution or
      render the unresolved-entity honest miss.
   3. Function-grain coverage contradiction: focus=createTask, "does it have tests" → "No tests
      cover it." while `/tests createTask` shows `test/tasks.test.mjs`.
   4. "what does <module> do" walls while "what does the app do" answers — extend the overview
      route to module grain.
   5. The off-topic orientation blurb never shortens on repeats (the one-liner exists only on the
      parse-wall route). Minor: "thanks, <clause>" walls; "what does X export" answers in
      misleading `reexports` vocabulary; `describe <fn>` doesn't surface taught facts.
3. **Track-1 trio** (pronoun / temporal / discourse-count) — deferred with **measured targets**
   (advisor tick-4, full-pool dry-run): pronoun red set = 18 ids (g-b1-pron
   1,4,5,7,12,13,16,18,20,21,22,28,30,33,35,36,48,50; + g-c2-pron unmeasured at full depth);
   temporal = g-b1-temp ×5 (7,31,44,46,49) + g-c1-temp ×9 (tick-4's 11 minus 24/25, which the
   author lane flipped at the gate: 10,12,23,28,29,33,39,47,48). **Re-measure g-b1-disc-count
   full-25 FIRST** — sampled 0/5 red at tick-4, likely already green; redirect that budget to the
   pronoun reds. Also grows the 4 under-covered dual-draw cells.
4. **Perf at monorepo scale** (advisor tick-4 #1, queued as first post-release perf lever):
   memoize `edgesOfKind` per (graph, kind) with a WeakMap + add by-subject/by-object endpoint
   indices (mirroring `adjacencyForKinds`). No crash-class hazard remains; these are latency/GC
   cliffs on 27k-module graphs (`edgesOfKind` rebuilds full kind arrays per call; renderPlan chains
   ~5 full-kind scans; `resolveObject` does full O(E) sweeps per unresolved term).
5. **`test/goal-reasoner.test.mjs` shared-ctx conversion** — convert to the shared run-ctx pattern
   the runner now uses (hygiene; keeps the suite honest about per-case isolation).
6. **seonix coordination** — the pin-0.8.2 advice + scale-bug heads-up are SENT (see
   `~/.claude/inboxes/codememory.md`, 2026-07-06/07 from `mechanic`): seonix gates its cutover on
   0.8.2 and expects a **ping on `codememory` the moment 0.8.2 ships** — do that right after the
   push. Watch `~/.claude/inboxes/mechanic.md` between tasks; the wh monorepo (27,770 modules) is
   the live scale testbed — ask for anything slow/broken there (feeds #4).
7. **Next playtest cadence** — the 0.8.2 confirmation playtest is done (greenlit). Next
   `SKILL_CHAT_PLAYTEST` run after follow-up #2 lands, aimed at the residual list + memory-full
   recall behavior; freeze any new flows as `test/chatflow-*` transcripts.
8. **The push** (operator): pushing `main` publishes 0.8.2 via CI; then the seonix ping (#6).

### Bench reuse map (0.8.0–0.8.2 deterministic runs are FROZEN; judged state below)

Deterministic AGENTBENCH/CHATBENCH reproduce byte-identically and are always safe to re-run —
AGENTBENCH has no judge at all. **The judged CHATBENCH is the only expensive part and must never
be blanket-reused across a text change.** Current judged state: **0.8.1 scores are the judged
record**; they are **STALE on {graph-query, honesty-miss, multi-turn-focus, memory-recall,
ambiguity, conversational, typo-fuzzy, noise} + graded assert cells** (0.8.2 changed answer text
on those surfaces; deferral was a deliberate ship-over-delay call) and **valid on the untouched
tags** (bootstrap-empty). Follow-up #1 clears the stale set; until then, quote 0.8.2 evidence from
the deterministic tier only.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every commit;
coordinator + background sub-agents, disjoint file-ownership, worktree-isolated, merged back; a ~5-min
completion-driven **strategy advisor** running throughout; CHATBENCH/AGENTBENCH artifacts match
`package.json` version, `_00N` for re-runs; no LLM in the product path (the CHATBENCH judge lives only
in the eval harness; AGENTBENCH grading is deterministic).

*History (Phases 0–10, releases 0.2.0→0.7.1) lives in git + the `CHATBENCH_*` / `archive/PLAN_*`
artifacts. Phase 11 (0.8.0 → 0.8.2) is in `CHATBENCH_0.8.*` / `AGENTBENCH_0.8.*` /
`STRATEGY_ADVISOR.log` + `PLAN_CHAT_FEEL.md` + `src/router/` + `agentbench/`.*
