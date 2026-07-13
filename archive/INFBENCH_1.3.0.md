# INFBENCH_1.3.0 — INF-C1 fabrication fix confirmed in a full fresh sweep; ladder unchanged elsewhere

**Headline:** first INFBENCH re-run since `1.2.0`, against the current **1.3.0** codebase (per
`package.json`; `git log` shows `chore(release): 1.3.0` two commits back from HEAD, with
`88a0e6f fix(chat): GENERAL_VERB_YESNO_RE no-hit declines instead of fabricating "no"` landed
immediately after it, plus a rule-storage foundation and two `PLAN_TAUGHT_RELATIONS.md` phases
since). `npm run infbench` ran to completion cleanly, in the foreground, watched end-to-end (no
backgrounded-and-abandoned run) — same 199 generated cases, same default seed (`20260707`), same
seven per-template counts as `1.2.0`. One result moves, and it is the one this cycle exists to
check:

1. **Chat/INF-C1 flips back from `1.2.0`'s 0% completion / 93% fabrication to 93% completion / 0%
   fabrication** — the fix in `88a0e6f` (`GENERAL_VERB_YESNO_RE`'s no-hit branch now returns `null`
   and declines instead of asserting a confident "no") holds under a genuine fresh 199-case sweep,
   not just the fix dispatch's own two-test unit check. The exact same 28/30 rows that fabricated a
   "no" at `1.2.0` (`inf-c1-card-exactly-min-001..015`, `inf-c1-card-max0-001,002,003,004,005,006,
   007,010,011,012,013,015`) now come back the honestly-pinned `"unproven"`; the same two rows that
   were merely "unclear" at `1.2.0` (`inf-c1-card-max0-009`, `-014`) are still merely "unclear" —
   same non-passing set, zero regressions, zero new fabrications anywhere in the 199-case pool.
2. **Nothing else moved.** INF-A1, INF-A2, INF-B1, INF-B2, and INF-C2's numbers are identical,
   band-for-band and case-ID-for-case-ID (via the non-passing-rows list), to `1.2.0`'s run. The two
   `PLAN_TAUGHT_RELATIONS.md` phases that landed since `1.2.0` (relational-fact-teach +
   adjective-mint, Phase 1; the rule-storage foundation, Phase 3; `findReachableSet`, Phase 6
   kernel-only) show **zero measurable effect on any INFBENCH band** — confirmed by identical
   numbers, not assumed from the phases' own scoping notes.

**The ladder still gates at INF-B1** (33% completion, unchanged from `1.2.0`/`0.8.2`), so nothing
here changes what ships this cycle — but the fix restores INF-C1 to being an honest,
skipped-with-a-receipt ceiling again rather than a live fabrication hiding behind the B1 gate.

## The metric pair, per band — KERNEL arm (30 cases; A1/A2 only, same scoping as `1.2.0`/`0.8.2`)

`node infbench/run.mjs` (raw: `infbench/results/raw/run-1.3.0/product.jsonl`)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| **all** | **30** | **30** | **100%** | **0%** | **PASS** |

Unchanged from `1.2.0`. The kernel prover doesn't see `chat.mjs`'s query lanes at all, so it was
never going to move this cycle.

## The metric pair, per band — CHAT arm (199 cases; `runChat()`, taught premises then the query)

| band | n | pass | completion | fabrication | gate | vs. `1.2.0` |
| --- | --: | --: | --: | --: | --- | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS | unchanged |
| INF-A2 | 40 | 40 | **100%** | 0% | PASS | unchanged |
| INF-B1 | 39 | 13 | **33%** | 0% | **FAIL — gates the ladder here** | unchanged |
| INF-B2 | 40 | 40 | 100% | 0% | skipped (gated by INF-B1) | unchanged |
| INF-C1 | 30 | 28 | **93%** | **0%** | skipped (gated by INF-B1) | **0%/93% → 93%/0%** |
| INF-C2 | 20 | 0 | 0% | 0% | skipped (gated by INF-B1) | unchanged |
| **all** | **199** | **151** | **76%** | **0%** | n/a — ladder-gated | 62%/14% → 76%/0% |

Ladder: A1 → A2 → B1 → B2 → C1 → C2, **gated at INF-B1 completion 33% < 50%** — the same gate
point as `1.2.0`/`0.8.2`. B2/C1/C2 remain reported skipped-with-a-receipt exactly as before; B2's
raw 100% and C2's raw 0% are unchanged ceiling markers (§3 of `1.2.0`'s report, still accurate).
**C1's raw numbers are back to being a genuine ceiling marker, not a fabrication** — this is the
one real move this cycle, and it is the fix working as intended.

## Reading the fix — INF-C1's 93%/0% is confirmed, not re-asserted from the commit message

| | chat `1.2.0` (broken) | chat `1.3.0` (this run) | fix-dispatch's own claim (commit `88a0e6f` + HANDOVER item 2) |
| --- | --: | --: | --: |
| INF-C1 completion | 0% | **93%** | "93% completion" |
| INF-C1 fabrication | 93% | **0%** | "0% fabrication" |
| non-passing rows | 28 fabricated + 2 unclear | 2 unclear only | "2 remaining non-passing rows are the pre-existing unclear quirk" |

The fix dispatch's own verification was narrower than this: `test/chat-generalverb-query.test.mjs`
gained one corrected assertion (the existing "does margo eat cake" case, previously pinned to the
fabricating "no", now pinned to the honest decline) plus one new zero-taught-facts case — two unit
tests, not a full-pool sweep — and its commit message/HANDOVER.md's item 2 *asserted* a
`npm run infbench` re-run without a committed report artifact to check it against. This dispatch's
job was to independently reproduce that number from a genuinely fresh, watched-to-completion run
rather than take the commit message on faith, and it now does: **93% / 0%, byte-for-byte the same
case IDs**, confirming the fix-dispatch's claim rather than merely repeating it.

Tracing the mechanism confirms it is the SAME fix, not a side effect of something else: pulling the
raw product rows for the two cases named in `1.2.0`'s report —

```
inf-c1-card-exactly-min-001 (premise "every scope has exactly 2 flags",
  query "does every scope have at least 1 flag")
observed: unproven (pass)
answer: "couldn't compile this compositional question (a superlative needs an entity kind
  (module, class, function, …)). compositional queries also work: …"
```

```
inf-c1-card-max0-001 (premise "every server has at most 0 developers",
  query "does a server have a developer")
observed: unproven (pass)
answer: "couldn't resolve one of the terms in this question. …
  Goal (inferred): Locate what a module/class defines."
```

Both are `miss:true` (chat declines, doesn't assert) — the honest-miss cascade the fix's `null`
return now falls through to, exactly as `88a0e6f`'s diff describes (`GENERAL_VERB_YESNO_RE`'s
no-hit branch: `return null; // no remembered fact — the honest miss stands`). One genuinely new
observation this run surfaced, not called out by the fix commit: the two traced cases land on
**different** downstream honest-decline messages (a compositional-superlative compile-decline for
the "at least N" phrasing; an entity-resolution decline for the "has a developer" phrasing) rather
than a single uniform "I don't know" — because once `GENERAL_VERB_YESNO_RE` declines, the query
falls through to whatever the NEXT lane in `chat.mjs`'s dispatch chain is, and that varies by
surface phrasing. This is cosmetic (both are still honest, both still grade "unproven" correctly)
but worth naming: the fix's effect is "stop this one lane from fabricating," not "route these
queries to one consistent honest-miss message."

## What INFBENCH found that the plan didn't anticipate, this run specifically

1. **Nothing.** Unlike `1.2.0`'s run (which surfaced the INF-C1 fabrication as a new, unanticipated
   red), this run's only band-level move was in the direction the fix was built to produce, and it
   landed exactly as the fix commit predicted (93%/0%, `0.8.2`-era ceiling restored).
2. **The two `PLAN_TAUGHT_RELATIONS.md` phases that landed between `1.2.0` and `1.3.0` (relational
   fact teach + adjective-mint; the rule-storage foundation; `findReachableSet`'s kernel half) do
   not touch any INFBENCH band.** Checked directly, not assumed: every band's non-passing-row list
   is identical in content to `1.2.0`'s except INF-C1's (which moved for the traced reason above),
   and INFBENCH's own templates (`is X a Y` / `does X V Y` / cardinality / disjointness /
   inconsistency) don't exercise the new relational-fact-teach phrasing ("X is the father of Y"),
   adjective-mint phrasing ("X is bespoke"), or rule-storage machinery (`RULE_CLASS`, `appendRule`)
   at all — no case in `cases.jsonl` was regenerated or reworded to touch them, and none of the new
   surfaces are reachable from the existing generator templates. Named explicitly because the task
   asked whether teach/recall work plausibly shifted a band; the honest answer, checked against the
   actual per-case results rather than assumed either way, is no.
3. **`inf-c1-card-max0-009`/`-014`'s "unclear" quirk is unchanged** — same two case IDs, same
   non-pass reason, present at `0.8.2`, `1.2.0`, and now `1.3.0`. Still not investigated as part of
   this or the prior measurement cycle (it's a disambiguation quirk, not a fabrication, and doesn't
   affect the gate).

## Scope decisions (deviations worth naming explicitly — unchanged from `1.2.0`/`0.8.2`)

- **The kernel arm only runs where its actual domain matches the question**: `a1Lookup/subClassOf`
  and `a2ChainLen2/taught-only` remain the only templates whose query is a pure class-to-class
  `rdfs:subClassOf` question; every other template declares `arms: ["chat"]` only.
- **INF-B2/C1/C2's `expect.verdict` is still pinned to the honest ceiling (`"unproven"`/
  `"inconsistent"`) by construction, not to the raw classical truth-value** — this is exactly why
  INF-C1's flip back to a clean 93%/0% is legible as "fix confirmed" rather than "the classical
  answer became provable": the pinned literal never moved between `1.2.0` and `1.3.0`, only the
  chat surface's behavior did.
- **Proof receipts (`expect.proof`) are still recorded but not actively graded** — unchanged from
  `1.2.0`.

## Discipline — the non-negotiables, checked

- **Zero-fabrication anti-circularity**: confirmed unaffected — every `expect` literal in
  `infbench/cases.jsonl` is a pure function of its own template parameters, unchanged since
  `0.8.2`; `infbench/grade.mjs` and `infbench/generate-cases.mjs` are untouched by any commit since
  the harness landed (`git log -- infbench/` shows only the original harness commit), so this run's
  numbers are a genuine product-side measurement, not an artifact of a grader/generator change.
- **Fixture lint enforced at generation time**: `node infbench/generate-cases.mjs` completed with no
  lint errors, same 199-case, 7-template breakdown as `1.2.0`/`0.8.2` (`a1Lookup 30, a2ChainLen2 40,
  b1Disjoint 39, b2ChainLenK 30, b2Svf1 10, c1Cardinality 30, c2Inconsistent 20`).
- **Determinism**: same default seed (`20260707`, no `--seed` override — confirmed this is a genuine
  apples-to-apples comparison against `1.2.0`'s run), same case count and per-template breakdown.
  The `--replay` byte-comparison itself was **not** re-run this cycle either (same reasoning as
  `1.2.0`'s report: it's an expensive check on top of an already multi-minute 199-case `runChat()`
  sweep, and this is a routine re-measurement, not a stage-0 harness-validation pass).
- **The run was watched to completion, not backgrounded and abandoned**: `npm run infbench` was
  launched and this session blocked on it (polling for the underlying `node` processes to exit)
  until it printed its final per-band table and `product: .../run-1.3.0/product.jsonl` — the full
  console output, including the per-band tables and the 48-row non-passing list, was captured and
  read in full before writing this report.

- **HANDOVER.md/ROADMAP.md bullet**: per this task's own instruction, skipped — `HANDOVER.md` was
  found modified/uncommitted (the concurrent dispatch's in-flight session-diary edits) when checked
  immediately before any write, so no bullet was added to either file this cycle to avoid a
  collision. Noted here instead, as instructed.

## Reproduce

```
npm run infbench
# or, separately:
node infbench/generate-cases.mjs --seed 20260707
node infbench/run.mjs --stamp 1.3.0
node infbench/run.mjs --stamp 1.3.0 --replay   # determinism check (slower — not re-run this cycle)
```

## Cross-check against `PLAN_INFERENCE_TESTING.md`'s own predictions (§1 "Reachable today?", §3)

- **B1 "HALF" → still exactly half, as predicted, unchanged for the third consecutive measured
  version** (`0.8.2`, `1.2.0`, `1.3.0` all land at 33% completion, `control` variant passing,
  `direct-member`/`lifted-member` still failing on the same 26 case IDs each time).
- **INF-C1 is now back to matching the plan's ORIGINAL predicted shape** ("NO — tier-5," an honest
  ceiling once un-gated) rather than `1.2.0`'s anomalous "wrong failure mode" (93% fabrication).
  `1.2.0`'s report flagged that flip as a genuine mismatch between prediction and measurement; this
  run confirms the mismatch was a transient, now-fixed regression in one query lane, not a durable
  change to what the ladder's C1 rung actually measures.

## Next (per `PLAN_INFERENCE_TESTING.md` §4 — not actioned this dispatch, measurement only)

- **Stage 3 (`cax-dw` + the ⊑-lift)** is still what INF-B1 is gating on, unchanged across three
  measured versions now — 26 of 39 B1 cases are still sitting on a real, provable "no" the engine
  doesn't compute yet. This remains the single highest-leverage next build stage on the ladder.
- **INF-C1 is a clean ceiling again** and should be treated as such (skipped-with-a-receipt behind
  the B1 gate) until stage 4 (cardinality entailment) is actually built — no further action needed
  on the fabrication itself; it's fixed and confirmed.
- The `-max0-009`/`-014` "unclear" quirk remains open, low-priority, and unchanged across three
  versions — still not blocking anything on the ladder.
