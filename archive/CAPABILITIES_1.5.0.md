# CAPABILITIES_AUDIT_2026-07-10_002.md — tmct capability audit (refresh 3)

**Refresh 3 — pinned after the 12-item HANDOVER.md follow-up batch landed plus a 3-round
`SKILL_BENCHMARK_CONVERSATION.md` capped sprint, 2026-07-10 (same calendar day as `_001`, later
session).** `_001` closed out the four fresh 1.4.1 benchmark reports and named 12 ranked follow-ups
as `HANDOVER.md`'s "next session" list. This refresh reports on THAT session: all 12 items are now
done, committed, and confirmed regression-free by a fresh full CHATBENCH/INFBENCH re-run against the
post-merge `HEAD` (not just per-item spot-checks) — see `HANDOVER.md`'s own "Where we are" for the
exact test counts. `_001`'s own git history preserves it; nothing here overwrites it.

---

## 0. Changes since `_001` — the explicit diff (read this section first)

| Row / item | `_001` verdict | `_002` verdict | What changed |
|---|---|---|---|
| **Reasoning (multi-hop)**, comparative table | Comparable short chains, Weaker as depth grows | **Comparable, materially narrower gap** | `cls-svf1` (someValuesFrom restriction membership) now has live chat-query wiring (item 4) — INFBENCH INF-B2 80%→100%. The kernel-vs-chat-wiring gap `_001` flagged as this benchmark's last open item is closed. |
| **Memory & multi-turn context retention**, comparative table | Comparable-to-stronger for Sonnet/Opus, anaphora a known weak spot | **Comparable-to-stronger, anaphora gap substantially closed** | C2 `pronoun-binding` — CHATBENCH's clearest lever, a "long-standing hardest-tier ceiling" untouched across multiple prior sessions — is now FIXED (item 1): the root cause was a routing bug (`parseAnaphora` never checked for in-sentence-named candidates before demanding a previous turn), not a genuine coreference-resolution gap. All 4 target cases (`g-c2-pron-3/7/8/10`) now pass CHATBENCH tier-1. |
| **Natural language generation & fluency**, comparative table | **None** — flat, uniform "Stronger" for every model | **None → partial, but narrower than hoped** | `src/completions/` is now wired into live chat dispatch (item 7) — a real (4e) COMPLETIONS RESCUE lane exists and fires for the exact target phrasing. But the sprint found a deeper architectural limit `_001`'s speculative TO-BE didn't anticipate: `broadSearch` only ever searches memory **blocks** written via an explicit `saveBlock()` call, never the live graph or taught Facts directly — so it can only answer a "detailed summary" question when the subject was already discussed via a mechanism nothing in ordinary chat teaching/asking triggers. Net effect: this row moves off a flat "None" (the wiring is real and it DOES work under the right conditions) but the practically-common case — a first-ever question about a subject — still declines. See §1 row 50b. |
| C2 pronoun-binding | Ranked #1 follow-up, "no work landed on it this session" | **DONE** | See above. |
| A2 naming-vocabulary (`g-a2-naming-2`/`6`) | Ranked #6, "fresh signal... may be a quick fix or may reveal something deeper" | **DONE, was a quick fix** | The meta-fallback-to-real-entities check only ever matched `class === "Class"`; widened to Class/Function/Method/GlobalVariable/Attribute with global (not per-class) uniqueness, and extracted so the bare "what is X" form (no article) reaches it too, not just the articled form (item 6). |
| `cls-svf1` wiring | Ranked #4, "best-scoped item on this list" | **DONE** | See row 1 above. |
| Farewell/thanks closed-set narrowness | Ranked #2, found by persona sweep | **DONE, then stress-tested further** | Generalized from exact-match literal strings to a bounded phrase-shape scan (item 2); THEN caught its own false positive on a real regression during implementation (an OK_ACK word like "right," at the head of a genuine question was briefly mistreated as a thanks signal — fixed before landing); THEN found two MORE gaps in the playtest sprint itself (a stacked discourse tag, and "brilliant" missing from the vocabulary) — both fixed. Still one known, deliberately-scoped remaining gap: the multi-clause scan's "every other clause ≤3 words" filler guard is stricter than some real closings need (see §5). |
| Teach-refusal message + recall gap | Ranked #3 | **DONE** | Message corrected (false "code-vocabulary nouns only" claim → the real grounding constraint); "what is the X of Y" now works as a reverse-relation reader alongside the existing "who is the X of Y". |
| "Who last touched X" superlative | Ranked #5 | **DONE** | New `whoLast` shape, parallel to the existing `when` shape's single-newest-commit logic. |
| Trailing "then" filler | Ranked #8 | **DONE, and found to recur 3 more times this session** | Fixed for `metaTermOf`'s bare "what is X" (item 8); the SAME bug class then turned up in `ISA_ASK_RE` ("is X a Y then" — playtest round 1), as a STACKED tag ("too then" — round 2), and needed a "too" vocabulary addition alongside — each fixed as found, same mechanism reused/extended each time rather than four separate implementations. |
| Has-a-method teach shape | Ranked #9, needed an operator scope decision | **DONE — built as a new ACE pattern, per operator decision** | `TEACH_HAS_METHOD_RE` + two query readers (yes/no and open-list), narrowly scoped, 10 new tests. One known limitation carried forward: with a real code graph loaded, ask.mjs's own structural grammar shadows the yes/no reader for some phrasings (documented, not a regression). |
| Batch of smaller parsing gaps (capability routing, feelings, "mod" abbreviation, describe-about, dropped article) | Ranked #10 | **DONE** | All 6 sub-items fixed; "class is not a class" left as-is per `_001`'s own note that it already resolves to a safe, honest (if oddly-specific) miss. |
| Chat-surface debt re-measure | Ranked #12, the one untouched Phase 0 item | **DONE** | All three named gaps (pronoun/focus binding, discourse-count anaphora, temporal-over-relative composition) re-measured against current `HEAD`: each narrowed materially this session but none fully closed. Two NEW confidently-wrong bugs found during re-measurement (not previously known): a `calls`/`callsSymbol` union miss in the yes/no ask-shape, and a passive "is/was X touched" misparse. Both documented in `PLAN_AGENTS.md` §3, neither fixed yet. |
| `scm-svf`/cardinality monotonicity | Ranked #11/#6, "no action needed" | **Unchanged — still no action needed** | Confirmed unmeasurable against the current INF-C1 fixture again this session; carried forward verbatim. |
| AGENTBENCH | "needs no action" | **Unchanged — not re-run** | Nothing touched its surface this session; last confirmed byte-identical to `0.8.2` in `_001`. |
| — | — | **3 NEW findings from the playtest sprint, not on `_001`'s list at all** | The completions/`broadSearch` architectural gap (above); a teachLane dispatch mystery (a short general-verb or ownership sentence — "grace mentors alan", "sam owns TaskController" — silently fails to store even though its own regex matches in isolation, root cause not yet traced); a stranger-first-turn preamble gap ("hey, first time trying this out - what is in here?"). All three are the single biggest levers for the NEXT session — see `HANDOVER.md`'s own ranked list. |

---

## 1. Comparative agent-capability table: tmct vs. named models, and a speculative TO-BE (refreshed)

Same framing as `_001` — general agent-capability taxonomy, not tmct's own benchmark names; columns
are specific named models, not brands; every model cell is an informed estimate, not a measured
cross-benchmark result. Only rows that moved are reproduced in full below; everything else is
**unchanged from `_001`** (tool use, planning, code generation, autonomy, safety/honesty,
instruction-following — see `_001` for the full original table).

**Quick-reference (verdict only, MOVED rows only):**

```
┌─────────────────────────────┬────────────────────────┬──────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
│         Capability          │          tmct          │ Llama 3.1 8B │   Nova Pro    │   Haiku 4.5   │   Sonnet 5    │   Opus 4.8    │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Reasoning (multi-hop)       │ INF-B2 wired, 80→100%  │ Comparable   │ Comparable    │ Comparable    │ Stronger      │ Stronger      │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ Memory & context (anaphora) │ C2 pron-binding fixed  │ Weaker       │ Comparable    │ Comparable    │ Comp-Stronger │ Comp-Stronger │
├─────────────────────────────┼────────────────────────┼──────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│ NL generation & fluency     │ wired but block-only    │ Stronger     │ Stronger      │ Stronger      │ Stronger      │ Stronger      │
└─────────────────────────────┴────────────────────────┴──────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
```

| General agent capability | tmct — measured evidence (2026-07-10 refresh 3) | Llama 3.1 8B | Amazon Nova Pro | Claude Haiku 4.5 | Claude Sonnet 5 | Claude Opus 4.8 |
| --- | --- | --- | --- | --- | --- | --- |
| **Reasoning (logical / multi-hop inference)** | Full INF-A1…C2 ladder passes; INF-B1 100%, INF-B2 now 100% too (`cls-svf1` live-wired this session, was 80%); fixed-depth 2-hop taught-syllogism chains, both rules on the ladder now chat-reachable, not just kernel-proven | **Comparable** on short chains, **Weaker** as chain depth/ambiguity grows | **Comparable** | **Comparable** | **Stronger** | **Stronger** — arbitrary-depth reasoning, not capped at a fixed ladder depth |
| **Memory & multi-turn context retention** | Session-scoped persistent graph; anaphora/focus carried within a session — including, as of this session, in-SENTENCE anaphora resolution ("which of them <filter>" naming its own candidates, not just a previous-turn result set) — closing CHATBENCH's own clearest concentrated weakness (C2 pronoun-binding, 0/10→4/4 tier-1 on the target cases) | **Weaker** — context-window/attention degradation over long sessions, no persistent store | **Comparable** | **Comparable** | **Comparable-to-stronger** — the anaphora gap that used to widen this row's distance is now materially narrower | **Comparable-to-stronger** |
| **Natural language generation & fluency** | **Partial, new this session** — a real (4e) COMPLETIONS RESCUE lane now wires `src/completions/`'s extractive, cited, groundedness-checked multi-sentence pipeline into live chat for an explicit "detailed summary of how X works" phrasing, and it genuinely works when the subject has prior material to search. But `broadSearch` only ever searches memory blocks written via an explicit `saveBlock()` call (never the live graph or taught Facts), so a first-ever question about ANY subject in a session still declines — confirmed live, twice, in this session's own playtest sprint. Net: moved off a flat "None," but the common case (first mention) is still uncovered | **Stronger** — general, unconditioned fluency, no equivalent gap | **Stronger** | **Stronger** | **Stronger** | **Stronger** — still the one row where every model beats tmct by design, though the gap on IN-DOMAIN, grounded prose specifically (not general fluency) is now genuinely narrower than a flat "None" implies |

**The pattern, updated**: `_001` found tmct beating or matching every model on exactly two axes
(zero-fabrication grounding, deterministic instruction adherence). This refresh doesn't add a third
structural-strength axis — the reasoning and memory rows moved by closing REAL implementation gaps
(wiring that existed at the kernel level finally reaching chat), not by tmct gaining a new kind of
capability, and the generation row's move is real but partial (still "None" for the common case).
The eight-row structural-absence pattern from `_001` still holds in shape, just with two of those
rows now measurably closer and one partially opened.

### Speculative TO-BE (updated)

`_001`'s three TO-BE levers are now TWO DONE and one PARTIALLY done:

- ~~`cls-svf1`'s live chat-query wiring~~ — **DONE this session** (item 4). INF-B2 80%→100%, as
  predicted.
- ~~C2 `pronoun-binding`~~ — **DONE this session** (item 1), and more completely than `_001`'s own
  cautious framing expected: `_001` called this "the clearest, highest-impact lever" but a
  "long-standing hardest-tier ceiling... no work landed on it" across multiple prior sessions,
  implying deep difficulty. The actual root cause was a routing bug, not a linguistic one — once
  correctly diagnosed, the fix was contained and all 4 target cases now pass.
- **Wiring `src/completions/` into chat dispatch** — **partially done** (item 7 landed the wiring
  itself), but the playtest sprint found the deeper gap `_001`'s speculative framing didn't
  anticipate: the search layer underneath the wiring (`broadSearch`) only draws from pre-seeded
  memory blocks, not the graph or Facts directly. **New speculative next step**: a real
  `graphService`-shaped adapter (the exact interface `broadSearch` already expects —
  `.search(q, {limit})`/`.ask(q)`) wrapping the loaded graph/`ask()`, wired into
  `completionsRescueAnswer`'s call to `generateCompletion`. Landing THIS would be the thing that
  actually closes the **NL generation & fluency** row's remaining gap for the common case, more so
  than the wiring alone did.

**New TO-BE items, from this session's own playtest sprint findings** (not on `_001`'s list at all):
a teachLane dispatch fix for short general-verb/ownership sentences (root cause not yet traced,
affects an unknown but plausibly nontrivial fraction of natural teach attempts); a stranger-first-turn
preamble widening. Neither changes any comparative-table row on its own — both are chat-surface
polish, not new capability classes — but both are real dead-ends a first-time user could hit.

---

## 2. The INF-B2 caveat — now resolved (mirrors `_001`'s own §2 pattern for INF-B1)

`_001` closed INF-B1's cax-dw wiring gap and flagged `cls-svf1` (INF-B2's own remaining item) as
"partial, new row" — kernel-complete, chat-wiring-incomplete, "the best-scoped item on
`HANDOVER.md`'s list." This refresh closes it the same way INF-B1 closed in `_001`: the exact
`cax-dw` live-chase pattern (`chat.mjs`'s `isaAsk` block, dynamic import, read-only, budget-capped)
copied for `deriveSomeValuesFromApplication`. Verified against the actual `b2Svf1Apply` CHATBENCH-arm
cases (not just the kernel arm): chat-arm pass 50%→100% on the targeted subset; full INFBENCH re-run
post-merge: 206/209 (99%) overall, INF-B2 specifically 50/50 (100%). The only 3 non-passing rows are
the already-known, already-accepted INF-C1 cardinality cases (item 11/`scm-svf`, unchanged, no action
needed). Same lesson as `_001`'s own §2: "implemented and unit-tested" (`_001`'s framing of
`cls-svf1`) was correctly distinguished from "chat-reachable" — closing that distinction was exactly
the right next step, and it worked.

---

## 3. Benchmark feature-support — updated with this session's fixes

### `SKILL_BENCHMARK_AGENT.md` (AGENTBENCH)

Unchanged — not re-run this session (nothing touched the router/goal-reasoner surface). Last
confirmed byte-identical to `0.8.2` in `_001`.

### `SKILL_BENCHMARK_CEFR_ENGLISH.md` (CHATBENCH)

- C2 `pronoun-binding` — **DONE** (was `_001`'s "todo", the clearest concentrated weakness). Root
  cause: `parseAnaphora` unconditionally treated "of them"/"of those" as referring to a previous
  turn's cached result set, even when the SAME sentence already named 2+ candidates in-sentence.
  Fixed by scanning for in-sentence code-identifier-shaped tokens before falling back to
  `opts.prev`. All 4 target cases (`g-c2-pron-3/7/8/10`) now tier-1 pass.
- A2 `naming-vocabulary` — **DONE** (was `_001`'s "todo, new signal"). Both `g-a2-naming-2` and
  `g-a2-naming-6` traced to the same root cause (the meta-fallback-to-real-entities check only ever
  matched `Class`, and only reached the articled form) and fixed together.
- Full post-merge re-run (not `--only`, the whole default pool): tier-1 108/109 (the one fail,
  `am-tests-cover`, is pre-existing — present in the `run-1.4.1` baseline BEFORE this session's work
  started, confirmed by direct comparison, not a regression).

### `SKILL_BENCHMARK_INFERENCE.md` (INFBENCH)

- `cls-svf1`'s live chat-query wiring — **DONE** (was `_001`'s "todo, the single best-scoped
  remaining lever"). See §2 above.
- `scm-svf`/cardinality monotonicity — unchanged, still correctly not built (confirmed unmeasurable
  against the current fixture again this session).
- Full post-merge re-run: 206/209 (99%), zero regressions from any of this session's merges.

### `SKILL_BENCHMARK_CONVERSATION.md` (capped sprint mode, run for the first time as a genuine
3-round cycle rather than a persona sweep)

- **3 rounds run, all 3 non-clean** (each found and fixed real dead-ends — the sprint's own stopping
  rule, two clean rounds in a row, was never triggered; it stopped at the 3-round cap with the well
  still producing). Round 1: 2 fixed (a trailing-tag `ISA_ASK_RE` bug, a confirmation-check-wrapper
  routing gap), 1 documented not fixed (a stranger-first-turn preamble gap), 1 confirmed architectural
  gap (completions/`broadSearch`). Round 2: 2 fixed (a stacked discourse tag, an adjective-property
  inheritance bridge — the SAME class↔instance bridge `isaAsk` already had, extended to the
  property-yes/no reader for the first time, a genuine teach-then-INFER fix). Round 3: 1 fixed
  ("brilliant" missing from the acknowledgement vocabulary), 1 new mystery found (a teachLane
  dispatch failure for short general-verb/ownership sentences, not yet root-caused), 2 genuine
  ceilings correctly named not forced (no runtime-behavior capability; the completions gap
  reconfirmed on a second subject).
- Regression-freezing — **done, for once, matching the discipline `_001` flagged as a gap**: every
  fixed dead-end this sprint landed with its own `test/chatflow-playtest-sprint-round{1,2,3}.test.mjs`
  file, not left as a transcript-only finding the way `_001` noted the prior sprint's 2 dead-ends
  were.

---

## 4. Plan feature-support — updated

### `PLAN_AGENTS.md`

**§3's one remaining open Phase-0 item — chat-surface debt re-measure — is now DONE** (was `_001`'s
open item, inherited unchanged from refresh 1). All three named gaps (pronoun/focus binding,
discourse-count anaphora, temporal-over-relative composition) re-measured against current `HEAD`:
each narrowed materially since the stale `CEFR_ENGLISH_0.7.1` baseline the plan cited, none fully
closed. Two new confidently-wrong bugs surfaced during the re-measurement itself (a `calls`/
`callsSymbol` union miss in a yes/no ask-shape; a passive "is/was X touched" misparse) — both
documented in the plan directly, neither fixed yet. **Which benchmark uplift helps most, updated**:
`_001` named CHATBENCH's C2 pronoun-binding score as the highest-leverage uplift for this plan — that
uplift landed this session; the next-highest lever is now closing the two newly-found bugs above,
since they sit directly on the same pronoun/focus-binding surface this plan's own goal-reasoner
depends on.

### `PLAN_CODE.md` / `PLAN_GUESS_NUMBER.md` / `PLAN_HANOI.md`

Unchanged from `_001` — nothing touched these plans' surfaces this session.

### `PLAN_TAUGHT_RELATIONS.md`


---

## 5. Non-benchmarked capabilities — updated

`_001` named three capability areas real benchmarks structurally can't measure: the completions
pipeline itself, taught-relation learning+inference, and fluid conversational flow end-to-end. This
session's playtest sprint is the FIRST time the third of those was actually exercised as a genuine
3-round capped sprint (not a persona sweep), and it surfaced value `_001` could only gesture at:

- **The completions pipeline's real limitation is now precisely characterized, not just "not
  reachable."** `_001` could only say the pipeline was unreachable from chat at all. This session
  wired it in AND then discovered — only possible once it was reachable — that its search layer has
  its own narrower scope than the wiring implies. This is a strictly more useful finding than `_001`
  could have produced, and it took a live conversation (not a benchmark) to find it, the same lesson
  `_001`'s §6 already drew about the wiring gap itself.
- **Teach-then-INFER, not just teach-then-recall, got a real second data point.** `_001`'s speculative
  framing treated this as one category; this session's round 2 found a SPECIFIC, previously-unknown
  instance (adjective-property facts had no inheritance bridge, unlike noun-kind facts) and fixed it
  with the same bridging mechanism already proven for noun-kind facts — a genuine, if narrow, inference
  capability improvement no benchmark scalar would show, since CHATBENCH grades isolated cases, not
  session arcs building on each other.
- **A NEW category `_001` didn't name at all: silent teach failures.** The teachLane dispatch mystery
  (short general-verb/ownership sentences failing to store with NO diagnostic message at all, not
  even an honest decline) is arguably worse than the dead-ends `_001`/refresh-1 catalogued, since a
  silent failure gives the user no signal anything went wrong — they may believe a fact was taught
  when it wasn't. This is exactly the kind of gap only a real multi-turn conversation surfaces; no
  benchmark case shape currently exercises "teach a short general-verb sentence, then check it stored."

---

## 6. Summary (refresh 3)

- **All 12 of `_001`'s ranked `HANDOVER.md` follow-ups: DONE.** Confirmed regression-free by a fresh
  full CHATBENCH (108/109, the one fail pre-existing) and INFBENCH (206/209, 99%) re-run against the
  post-merge `HEAD` — not just per-item spot-checks taken during implementation.
- **1 comparative-table row moved from a flat "Stronger-for-everyone" to a mixed/partial verdict**
  (NL generation & fluency) — the first time any row in this audit's history has moved off its
  uniform starting verdict, per `_001`'s own observation that the eight structural-absence rows were
  "not a spread of comparable scores." It's still mostly "None" in practice (the common first-mention
  case), so this is a real but modest crack, not a reversal.
- **2 comparative-table rows narrowed measurably without changing their overall verdict band**
  (reasoning: INF-B2 wiring closed; memory/anaphora: C2 pronoun-binding closed).
- **3 genuinely new findings, none on `_001`'s radar at all**, surfaced only by running a real
  3-round conversation rather than any scalar benchmark: the completions/`broadSearch` architectural
  ceiling, the teachLane silent-failure mystery, and the stranger-first-turn preamble gap. All three
  are now `HANDOVER.md`'s top-ranked follow-ups for the next session, in that order.
- **The single most consequential finding of this refresh, mirroring `_001`'s own §6 conclusion**:
  the "live wiring gap" pattern `_001` named (real, tested, engine-level code with no path from a
  live chat turn to reach it) turned out to have LAYERS. `cls-svf1` was a single-layer instance
  (wire it, done). The completions pipeline was a two-layer instance: wiring it in (this session)
  was necessary but not sufficient to reveal the SECOND gap underneath (the search layer's own
  narrower scope) — which only became visible once the first layer was fixed and a real
  conversation could actually reach far enough to test it. Benchmarks catch the first layer;
  only a live conversation catches the second.
