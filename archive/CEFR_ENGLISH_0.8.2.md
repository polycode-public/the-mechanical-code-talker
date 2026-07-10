# CHATBENCH_0.8.2 — the feel wave, deterministic tier (judged re-judge LANDED post-release — see final section)

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

## ⚠️ The judged tier was DEFERRED at release — read this first

> **UPDATE (2026-07-07): the re-judge LANDED** — see **"Judged re-judge (post-release)"** at the
> end of this document. The stale-tag list below is cleared; 0.8.2 judged scores are now the judged
> record for the touched tags. The rest of this section is kept verbatim as the release-time record.

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

---

## Judged re-judge (post-release) — the deferred tier, landed 2026-07-07

The first post-release bench action, per the plan above. **Judge pinned:
`claude-haiku-4-5-20251001` @ `judge-prompt-v1`, 3 samples/case, `--concurrency 12`.** Scope:
exactly the stale-tag list — the 47 v1 spine cases carrying {graph-query, honesty-miss,
multi-turn-focus, memory-recall, ambiguity, conversational, typo-fuzzy, noise} plus the 10 graded
**assert** cells from the release gate's own draw A (seed 1380087607: `g-b2-assert-3/-8/-10/-14/-22`,
`g-c1-assert-7/-9/-13/-19/-23`). **57 cases × 3 = 171 samples, 0 voids, 0 hard-fails, no
throttling** (concurrency held at 12 throughout). Fresh deterministic product run `--stamp 0.8.2`
(57/57 tier-1 pass); raw under `chatbench/results/raw/run-0.8.2/` (product.jsonl, judged.jsonl,
summary.json, console.txt, timings.json). Overall mean over the re-judged scope: **1.814 / 2**.

### The re-derived touched list first (honesty about scope)

The deferral's stale-tag list was deliberately conservative. At re-judge time the actual
answer-text diff (0.8.1 `product-a` vs the 0.8.2 gate run, per-turn, byte-level) shows only **four**
v1 cases with substantive text change — `gq-functions-call-fnalpha` (grain-fallback flip),
`conv-what-can-you-do` + `am-bare-name` (orientation examples now graph-derived, wall-kindness
item 5), plus the appended `gq-forward-method-calls` — and `mr-asked-before` differing only by the
run-volatile session uuid. **Every other case in the 8 tags, including both F4 honesty cells, is
byte-identical to 0.8.1.** The receipt-tail (prose→detail) change turned out not to touch any v1
judged render — those tails lived on surfaces the v1 spine doesn't sample. All 8 tags were
re-judged anyway (the decision scoped them), so every previously-stale tag now has a fresh 0.8.2
score and the stale list is cleared.

### Per-tag table (0.8.1 judged record → 0.8.2 re-judge)

| Tag | n | 0.8.1 record | 0.8.2 | Δ | Text changed? | Read |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| graph-query | 16 | 1.741 (n=15) | **1.788** | +0.047 | 2 cases + 1 new | ↑ — `gq-functions-call-fnalpha` 0 → 1.222 (hard-fail cleared), new `gq-forward-method-calls` = 2.0; like-for-like on the shared 15: 1.774 (+0.033) |
| honesty-miss | 5 | 1.600 | 1.511 | −0.089 | **none** | judge noise on byte-identical text — see F4 watch below |
| multi-turn-focus | 5 | 1.900 | **1.900** | 0.000 | none | flat-high, held |
| memory-recall | 3 | 1.833 | 1.778 | −0.055 | uuid only | noise band, n=3 |
| ambiguity | 4 | 1.250 | **1.417** | +0.167 | `am-bare-name` | 0.8.1 flagged its 1.250 as a downward noise draw (n=4); 1.417 sits between it and 0.8.0's 1.521, with the one real text change (`am-bare-name` 0.667 → 1.167) pulling up |
| conversational | 6 | 1.806 (0.8.0 carried) | **1.972** | +0.166 | `conv-what-can-you-do` | ↑ — graph-derived examples; 5 of 6 cases at 2.0 |
| typo-fuzzy | 4 | 1.917 (0.8.0 carried) | 1.806 | −0.111 | none | judge noise on byte-identical text, n=4 |
| noise | 5 | 1.900 (0.8.0 carried) | 1.845 | −0.055 | none | judge noise on byte-identical text |
| **assert cells (for record)** | 10 | — (never judged) | **B2 2.000 / C1 2.000** | — | teach-lane wave | both assert-recall cells perfect over the gate draw A sample; no prior judged baseline exists (0.8.1 judged A1 only) |

**Hard-fails: 0** (0.8.1's selective run carried 1). **`gq-functions-call-fnalpha` now scores:**
0.000 (all-dims-0) → **1.222** (groundedness 1, correctness 1.333, honesty 1.333) — the cycle-1
standing hard-fail is cleared on the judged tier too; the judge's residual reservation is the
Function/Method grain wording ("there is function Widget.render()" for what the fixture records as
a method), which is the known grain-fallback trade-off, not a fabrication.

### ⚠️ F4 regression watch (hm-unknown-module / hm-unknown-fn) — stated prominently

**`hm-unknown-module` dropped: 1.222 → 1.000** (honesty 1.333 → 1.0, rephrase 0.333 → 0);
`hm-unknown-fn` held flat at 1.000 (honesty 1, rephrase 0 — identical dims to 0.8.1). Per F4's
instruction this is reported prominently and **no code was changed**. The essential context: both
cases' answer text is **byte-identical to 0.8.1** — the receipt tail was never part of these two
renders ("no symbol matching \"zebra.mjs\" found in the index." / "no module matching
\"nonExistentFn\" found in the index."), so the F4 mechanism (receipt tail = grounded disclosure
the judge rewarded) cannot be what moved. The drop is one judge sample's worth of variance on
unchanged text over n=3 (same class as 0.8.1's ambiguity n=4 note). F4's conditional fix (restore
the receipt on genuine unknown-entity misses) is therefore NOT triggered by evidence of text
regression — but both cells sit at a mediocre 1.0 because the miss render offers **no rephrase
hint at all** (rephrase pinned at 0 in both versions); that is a real, pre-existing weakness worth
a lever of its own, not a 0.8.2 regression.

### What moved and why (the honest paragraph)

The wave's text changes moved exactly the cases they touched, and nothing else moved beyond judge
noise. The three substantive movers are all attributable: the Function↔Method grain fallback
cleared the judged hard-fail (`gq-functions-call-fnalpha` +1.222, the largest single-case move);
the graph-derived orientation examples (wall-kindness item 5) lifted both surfaces that render the
orientation blurb (`conv-what-can-you-do` → 1.833, driving conversational to 1.972; `am-bare-name`
+0.500, driving ambiguity's +0.167); and the appended `gq-forward-method-calls` entered at a clean
2.0. Every downward tag delta (honesty-miss −0.089, typo-fuzzy −0.111, noise/memory-recall −0.055)
sits on **byte-identical answer text** and small n (3–5 cases, 3 samples), i.e. the same judge
sampling variance CHATBENCH_0.8.1 documented for ambiguity n=4 — this run's ambiguity swinging
back +0.167 on essentially unchanged text (3 of its 4 cases) is itself the cleanest demonstration
that these small-n tags oscillate ±0.1–0.3 between draws. Judge-noise candidates for the record:
honesty-miss (n=5), typo-fuzzy (n=4), ambiguity (n=4), memory-recall (n=3). The assert cells'
perfect 2.000/2.000 says the teach/recall renders the wave reworked read as grounded and correct
to the judge, but with no prior assert baseline it is a first mark, not a delta. Net: **the judged
tier confirms the deterministic story — the wave improved what it touched and regressed nothing
the instrument can distinguish from its own noise.**
