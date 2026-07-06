# CHATBENCH_0.8.2 — the feel wave, deterministic tier (judged re-judge DEFERRED)

**Headline:** 0.8.2 is the chat-feel wave (PLAN_CHAT_FEEL items 1–5, 7, 8) plus a live-found scale
hotfix. The **deterministic tier is the release evidence**: **334 / 334 tier-1 (draw A)** — the
append-only pool grew 333 → 334 with `gq-forward-method-calls` — and **285 / 285 (draw B)**, **zero
tier-1 regressions across the whole wave**, and the standing hard-fail since cycle 1
(`gq-functions-call-fnalpha`) finally **flips green** (annotated `improvedIn: "0.8.2"` in the case
set). **The judged (LLM) tier was NOT re-run for this release** — see the deferral section below;
this document is deliberately judge-free.

Run (raw under `chatbench/results/raw/run-0.8.2-gate/`): dual-draw deterministic replay, stamp
`0.8.2-gate`, seeds a=1380087607 / b=1380087608, 619 graded+spine rows, wall **7.2 s**. `npm test`
green (**974**); CLI smokes exit 0.

---

## ⚠️ The judged tier is DEFERRED — read this first

0.8.2 changes answer TEXT on many judged surfaces (recall renders, preamble handling, call answers,
author renders, wall/miss renders, receipt tails moved out of prose). Per the bench-reuse rule
(HANDOVER: a text change on a judged surface makes carried judge scores stale even when
deterministic `answerMatch` still passes), the touched tags **require a re-judge** — and that
re-judge is **deferred post-release by operator decision (ship-over-delay)**. Consequences, stated
plainly:

- **The 0.8.1 judged scores remain the judged record**, and they are **STALE** on the touched tags
  until the re-judge lands. Do not quote 0.8.1 judged means for these tags as if they scored 0.8.2.
- **Stale tag list** (accumulated per advisor F4/F11 — the traversal-tail removal is CROSS-TAG, not
  confined to the feel items' own tags): **graph-query, honesty-miss, multi-turn-focus,
  memory-recall, ambiguity, conversational, typo-fuzzy, noise** + the **graded assert cells**.
- **Re-judge plan** (first post-release bench action): pinned judge (`claude-haiku-4-5-20251001` @
  `judge-prompt-v1`, 3 samples/case, `--concurrency 12`) over exactly those tags; carry untouched
  tags; re-derive the final list from actual answer-text diffs at re-judge time; regression-watch
  `hm-unknown-module` / `hm-unknown-fn` specifically (the receipt tail was part of what the judge
  scored as grounded disclosure — F4: if either honesty cell drops, restore the receipt on genuine
  unknown-entity misses only).
- The deterministic tier (below) is complete, byte-reproducible, and is what this release ships on.

---

## Part 1 — the deterministic joint result

- **Tier-1: 334 / 334 (draw A), 285 / 285 (draw B).** Every check passes, so zero pass→fail
  regressions by construction — across four feel merges, three router merges, and the scale hotfix.
- **Pool growth (append-only, recorded):** `gq-forward-method-calls` — "what does Widget.render
  call" must name `fnAlpha` and must NOT render the false-empty "has no calls edges". Added on
  advisor F3: the forward-direction fix otherwise shipped with zero bench coverage.
- **Dual-draw agreement 26 / 30 (0.867)**, down from 0.8.1's 0.933. Four cells are UNDER-COVERED
  (excluded from PASS/FAIL per SKILL §1, not failed): **B1 pronoun-binding+negation, B2
  assert-recall, B2 discourse-reference, C1 coordination-compositional**. Honest reading: the
  instrument's reliability dipped as the draws sampled more of the still-red B/C pool; growing
  these cells' pool/sample is part of the deferred trio work, not a product regression (tier-1
  disagreement is a sampling artifact — both draws pass 100% of what they draw).

### Baseline improvements now passing (the runner's own line, draw A)

25 cases with `baselineFail`-annotated turns now pass. Called out, with honest attribution:

- **`gq-functions-call-fnalpha` — the flipped hard-fail.** "which functions call fnAlpha" →
  **"in app/lib/b.mjs there is function Widget.render()."** (0.8.1: *"No functions found whose
  module directly calls fnAlpha. (traversal: callsSymbol edges where object = fnAlpha)"*). The
  standing all-dims-0 documented weakness since cycle 1, cleared by the Function↔Method grain
  fallback. **New in 0.8.2.**
- **`g-c1-temp-24` / `g-c1-temp-25`** — "who is the author of abc1234" now **names Ada Lovelace**
  instead of dumping the touch-set (0.8.1's own decision-log lever #2). **New in 0.8.2** (author
  lane).
- **Carried (flipped in 0.8.1 or earlier cycles, still green):** `hm-empty-result-calls`,
  `tf-modles`, `tf-wat-calls`, `ns-wondering`, `ns-hey-tmct`, `mt-focus-drift`,
  `mr-session-count`, `mr-asked-before`, and the graded side-effect cells
  `g-b1-pron-6/-15/-25/-39/-44`, `g-b2-disc-10`, `g-c1-temp-9/-18/-20/-22/-35/-45/-50`
  (+ `g-b2-disc-4`, new to this draw — draws are re-seeded, so per-id cross-version comparison is
  only valid on the intersection).

## Part 2 — what changed, per feel item (deterministic before/after)

1. **Recall hygiene** (`058fd7f`): walls/misses are never memorized or replayed as recalls;
   path-token noise can't fake a match; a fold re-clean heals already-poisoned stores. Before: a
   nested recall-of-a-recall-of-a-wall opened a playtest session. After: recall only cites real
   prior answers (`mr-*` anchors held green throughout, per the F5 guard).
2. **Preamble/politeness frames + determiner dedupe** (`bca0f69`): "hey there, quick question —
   which modules import X?" walls → answers; "what about the logger" no longer offers the same
   reading twice.
3. **Call self-consistency** (`20b2b2d` + `bca0f69`): calls∪callsSymbol on call questions,
   Function↔Method grain fallback (the `gq` flip above), Class-individual meta fallback ("what is a
   Record" now describes a class the bot itself lists), has-tests routed to coverage (before: "no
   defines edge from createTask to 0a1b2c3d4e5f" — a commit hash).
4. **Author lane** (`878dd0e`): "who is Grace Hopper" / "what did Grace Hopper touch" / "who
   authored abc1234" all answer via author→commits→touched (before: wall / "no module matching
   'Grace Hopper'").
5. **Wall kindness** (`878dd0e`): repeat suppression on the orientation dump, live graph-derived
   "what can you do" examples (not tmct's own repo symbols), "what does the app do" overview,
   riskiest-file + opinion + imperative + why-untested honest nudges (items 5+8). Receipt tails
   (`(traversal: …)`) moved from prose to a detail tier, recoverable via "why" (`20b2b2d`) — the
   cross-tag text change driving most of the re-judge scope.
7. **Teach lane widening** (`058fd7f`): "remember that saveStore is deprecated" (properties),
   "Priya owns tasks.mjs" (ownership), `teach:` source with a 0.95 trust prior, and the
   taught-class↔graph-`inherits` bridge ("is TaskController a handler" now bridges).

**Scale hotfix** (`eccb536`): argument-spread stack overflow in `edgesOfKind` past ~100k edges in
one relation group — found LIVE on a 27,770-module monorepo (`~/projects/wh`, via the seonix
session; "list modules in <dir>" crashed on every published version). Fixed with a plain
loop-append + a synthetic ~200k-edge regression test (`test/codegraph-scale.test.mjs`).

## Confirmation playtest (live, post-merge)

A live confirmation playtest re-drove every documented baseline failure — verdict **"materially
better than baseline, greenlight on feel"**: recall poison dead; politeness, calls-union, Record,
author lane, app overview, nudges, teach bridge, and ownership all confirmed; discourse "count
them" landed as a bonus. Residuals are named as **known issues** and ranked in HANDOVER.md's
follow-ups: recall half-match replay persists at ~20% of the old severity; a NEW confident-wrong
class (fuzzy-entity FALSE EMPTY: "which modules import logger" renders an empty as fact while the
full-path form answers); a function-grain coverage contradiction ("does it have tests" vs `/tests
createTask`); "what does <module> do" walls while the app-level form answers; the off-topic
orientation blurb never shortens on repeats.

## Decision

**Deterministic tier — PASS** (334/334 + 285/285, zero regressions, the cycle-1 hard-fail flipped,
pool append recorded, dual-draw under-coverage named). **Judged tier — DEFERRED**, stale tags
listed above; the re-judge is the first post-release bench action and 0.8.1's judged numbers stay
the judged record until it lands. Artifacts: `chatbench/results/raw/run-0.8.2-gate/`
(product-a/b, agreement, timings).
