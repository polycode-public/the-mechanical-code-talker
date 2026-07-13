# INFBENCH_1.2.0 — A2's taught-only gap closes to 100%; INF-C1 flips from a ceiling to a real fabrication

**Headline:** first INFBENCH re-run since `0.8.2`, against the current **1.2.0** codebase (per
`package.json`; `git log` confirms `chore(release): 1.2.0` at HEAD). `npm run infbench` still runs
cleanly end-to-end — no blocker, no missing script, same 199 generated cases from the same default
seed (`20260707`), same seven per-template counts as `0.8.2`. Two results move versus the baseline,
one good and expected, one a genuine red flag:

1. **Chat/INF-A2 closes from the documented 50% floor to a clean 100%, 0% fabrication, PASS** — the
   taught-only 2-hop chain (`inf-a2-*-taught-only`) goes from **0/20** to **20/20**. This is exactly
   what `PLAN_INFERENCE_TESTING.md`'s own STATUS banner (dated 2026-07-08, already in the plan
   before this run) claims stages 1+2 (`cax-sco` + the bounded `findIsaChain`/`renderIsaChain`
   proof-chase) would do — this run is the live confirmation of that claim, not a new discovery.
2. **Chat/INF-C1 flips from `0.8.2`'s 93% completion / 0% fabrication (a near-clean pass sitting one
   ladder rung below the gate) to 0% completion / 93% fabrication** — the SAME 30 cardinality cases,
   same pinned `unproven` literal, now come back a confident **"no"** instead of an honest miss.
   Traced below to a specific, nameable shipped feature (the general-verb-to-predicate query lane,
   `GENERAL_VERB_YESNO_RE`, `src/chat.mjs:3852-3855`) — a real fabrication, not a ceiling marker, and
   the most important finding in this run.

**The ladder still gates at INF-B1** (33% completion, unchanged from `0.8.2`), so nothing here
changes what ships this cycle — but the gate point is now hiding a worse problem than it was hiding
before: once B1 is eventually fixed, INF-C1 will not surface as a clean ceiling the way `0.8.2`
predicted it would; it will surface as an active fabrication that needs its own fix first.

## The metric pair, per band — KERNEL arm (30 cases; A1/A2 only, same scoping as `0.8.2` — see
"Scope" below)

`node infbench/run.mjs` (raw: `infbench/results/raw/run-1.2.0/product.jsonl`)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| **all** | **30** | **30** | **100%** | **0%** | **PASS** |

Unchanged from `0.8.2` — identical numbers, identical gate. The pure kernel prover was never the
part of the stack that moved this cycle; the kernel doesn't even see the codegraph or chat's new
proof-chase.

## The metric pair, per band — CHAT arm (199 cases; `runChat()`, taught premises then the query)

| band | n | pass | completion | fabrication | gate | vs. `0.8.2` |
| --- | --: | --: | --: | --: | --- | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS | unchanged |
| INF-A2 | 40 | 40 | **100%** | 0% | **PASS** | **50% → 100%** |
| INF-B1 | 39 | 13 | **33%** | 0% | **FAIL — gates the ladder here** | unchanged |
| INF-B2 | 40 | 40 | 100% | 0% | skipped (gated by INF-B1) | unchanged |
| INF-C1 | 30 | 0 | **0%** | **93%** | skipped (gated by INF-B1) | **93%/0% → 0%/93%** |
| INF-C2 | 20 | 0 | 0% | 0% | skipped (gated by INF-B1) | unchanged |
| **all** | **199** | **123** | **62%** | **14%** | n/a — ladder-gated | 66%/0% → 62%/14% |

Ladder: A1 → A2 → B1 → B2 → C1 → C2, **gated at INF-B1 completion 33% < 50%** — the same gate point
as `0.8.2`. B2/C1/C2 are reported skipped-with-a-receipt exactly as before. B2's raw 100% is still a
genuine ceiling marker (§3, unchanged reasoning from `0.8.2`); **C1's raw numbers are NOT a ceiling
marker this time — they are 28 real fabrications** (see below), which the ladder gate is currently
masking only because B1 already failed first, not because C1 is honestly declining.

## Reading the two arms together — the A2 signal closes exactly as the plan's STATUS banner claimed

| | kernel | chat `0.8.2` | chat `1.2.0` |
| --- | --: | --: | --: |
| INF-A2 taught-only (2-hop, both premises taught) | 20/20 yes | **0/20 — every case `unproven`** | **20/20 yes** |
| INF-A2 graph-bridge (1 taught hop + 1 codegraph `inherits` edge) | n/a | 20/20 yes | 20/20 yes |

This is the one clean, fully-traceable positive move in this run. `PLAN_INFERENCE_TESTING.md`'s own
STATUS banner (top of the file, dated 2026-07-08 — i.e. already written before this INFBENCH cycle,
not backfilled here) states plainly that stage 1 (`cax-sco`, `deriveTypePropagation`,
`src/syllogise.mjs`) plus the bounded live proof-chain chase (`findIsaChain`/`renderIsaChain`,
`src/chat.mjs`) closed chat-A2's measured 50% ceiling to 100%, 0% fabrication, deliberately scoped to
`maxHops:2` and taught/entailed facts only so it does not accidentally reach into B2's pinned
multi-hop ceiling. This run's 20/20 taught-only result is exactly that claim, independently
re-measured rather than taken on faith from the banner text.

## The new, real red this run surfaced — INF-C1 flips from an honest ceiling to a genuine fabrication

`0.8.2` recorded INF-C1 at 93% completion, 0% fabrication (28/30, with 2 rows on an "unclear"
disambiguation quirk) — a near-pass that stayed gated only because it sits above the failing B1
rung, not because anything was wrong with it. **That is no longer true.** Every one of the 28
previously-clean rows (`inf-c1-card-exactly-min-001..015`, `inf-c1-card-max0-001,002,003,004,005,
006,007,010,011,012,013,015`) now comes back a confident `"no"` where the case's own pinned literal
(a static function of the template's parameters, unchanged since `0.8.2`) is `"unproven"` — the same
`inf-c1-card-max0-009`/`-014` "unclear" quirk survives untouched, the only two rows that are still
merely incomplete rather than fabricated.

Traced to a specific shipped feature, not asserted: pulling the raw product row for
`inf-c1-card-exactly-min-001` —

```
premise: "every scope has exactly 2 flags"
query:   "does every scope have at least 1 flag"
answer:  "no — no remembered fact says every scopes have at least 1 flag.

          Goal (inferred): Look up a taught fact about a subject/verb/object."
miss:    false
```

— and `inf-c1-card-max0-001` —

```
premise: "every server has at most 0 developers"
query:   "does a server have a developer"
answer:  "no — no remembered fact says a servers have a developer.
```

Both answers are produced by the general-verb-to-predicate **query** lane shipped this session
(`GENERAL_VERB_YESNO_RE`, `src/chat.mjs:1850`; HANDOVER.md's "DONE: general verb-to-predicate
teaching's natural follow-up," item 5). Its handler (`src/chat.mjs:3837-3858`) maps the query verb
("have") through `generalVerbPredicate` to a predicate (`mgx:hasA`), looks for a matching taught
fact, and when none is found — line **3852-3855** — unconditionally returns `` `no — no remembered
fact says …` `` with `replace:true`, never falling through to chat's own honest-miss path. This is a
plain negation-as-failure: **absence of a specific fact is answered as a constructive "no,"** which
is precisely the shape `PLAN_INFERENCE_TESTING.md`'s ground rule forbids everywhere on the ladder
("there is no negation-as-failure anywhere on the ladder; 'no' is always a constructive proof from
disjointness or max-0," §5). The cardinality premises here ("has exactly 2 flags," "has at most 0
developers") were never taught as general `mgx:hasA` facts in the first place — they parse into
`owl:cardinality`/`owl:maxCardinality` restrictions, a different predicate shape entirely — so the
general-verb lane's lookup was *always* going to miss; the bug is that a miss on THIS lane answers
"no" instead of declining.

This is graded correctly as **fabrication, not an honest ceiling** — INFBENCH's grader
(`interpretIsaAnswer`, `infbench/grade.mjs:144-151`) reads chat's own `miss` flag as the
authoritative signal, and this reply sets `miss:false` (chat believes it answered, not declined), so
`gradeChatRow` marks it fabricated exactly as designed (`observed === "no"` while
`expect.verdict === "unproven"`). **This is not a grading bug and not something this dispatch is
attempting to fix** — `src/chat.mjs` is off-limits this dispatch (a concurrent session is mid-flight
on `src/syllogise.mjs`, and this task is measurement-only regardless) — but it is the single most
actionable finding in this run: a targeted guard on `GENERAL_VERB_YESNO_RE`'s no-hit branch (decline
instead of asserting "no" when the subject/object pair was never taught under ANY predicate, not just
the one being queried) would likely restore INF-C1 to at least its `0.8.2` ceiling, independent of
and before any cardinality-entailment engine work (§4 stage 4).

## What INFBENCH found that the plan didn't anticipate, this run specifically

1. **The INF-C1 fabrication above** — new this run, not present at `0.8.2`, and not a consequence of
   any change to `infbench/`'s own generator or grader (both are untouched since `0.8.2`'s commit,
   confirmed by identical per-template counts and identical pinned literals for these exact case
   ids). The cause is entirely product-side (`src/chat.mjs`'s new general-verb query lane), landed
   between `0.8.2` and `1.2.0`.
2. **Everything else `0.8.2` found — the corpus-contamination denylist, the "node" lexicon
   collision, and the C1 "unclear" ambiguity quirk on `-max0-009`/`-014`** — is confirmed still
   present and unchanged: same denylist mechanism in `generate-cases.mjs`, same excluded proper-name
   lemma, and the *exact same two case ids* still land on "unclear" rather than "unproven" or a
   fabricated "no." No new instance of any of these three was found.
3. **No plausible connection traced from item 6's inheritance-disclosure fix** (the "public methods
   of X" / membership-walk fix, `HANDOVER.md`'s item 6 and `test/chatflow-tier4.test.mjs`) **to any
   INFBENCH band.** That fix is scoped to method/membership listing queries, a different query
   surface than every INFBENCH template (`is X a Y` / `does X V Y` / cardinality / disjointness) — no
   case in `cases.jsonl` exercises it, and no product row shows its signature. Named explicitly
   because the task briefing asked whether it plausibly shifted a band, and the honest answer,
   checked against the actual case set, is no.
4. **`unknownObjectFallback` (the known-subject/unknown-object concept-minting fallback) does not
   appear to be in play here either** — every INFBENCH noun is drawn from the committed
   `lexicon-core.json` pool (minus the corpus-contamination and "node" exclusions), so every subject
   and object in every generated premise is already grounded before the fallback's ungrounded-term
   gate would ever trigger. No band's numbers are consistent with the fallback firing (no case
   depends on a freshly-minted concept surviving into a later turn). Named rather than assumed silent
   — this is inferred from the generator's own noun-sourcing discipline (§2.2), not verified by
   tracing a specific fallback invocation, since none was expected to occur.

## Scope decisions (deviations worth naming explicitly — unchanged from `0.8.2`)

- **The kernel arm only runs where its actual domain matches the question**: `a1Lookup/subClassOf`
  and `a2ChainLen2/taught-only` remain the only templates whose query is a pure class-to-class
  `rdfs:subClassOf` question; every other template declares `arms: ["chat"]` only, for the same
  reason `0.8.2` documented (a category-error "unproven," not a capability gap).
- **INF-B2/C1/C2's `expect.verdict` is still pinned to the honest ceiling (`"unproven"`/
  `"inconsistent"`) by construction, not to the raw classical truth-value** — this is exactly WHY
  INF-C1's flip to a confident "no" is legible as fabrication rather than "well, the classical answer
  actually is provable now": the pinned literal never moved, only the chat surface's behavior did.
- **Proof receipts (`expect.proof`) are still recorded but not actively graded** — no drive point
  produces a structured, rule-named connected proof chain to check yet (unchanged from `0.8.2`; §4
  stage 2's "proof-chain receipts" row is about a `{rule, premises, conclusion}` structure, distinct
  from the `findIsaChain`/`renderIsaChain` rendered-prose chase that already ships and drives A2's
  win above).

## Discipline — the non-negotiables, checked

- **Zero-fabrication anti-circularity**: confirmed unaffected — every `expect` literal in
  `infbench/cases.jsonl` is still a pure function of its own template parameters, unchanged from
  `0.8.2`; `infbench/grade.mjs` is untouched (`git log` shows no commits under `infbench/` since the
  harness landed), so the INF-C1 fabrication reported above is a genuine product-side regression, not
  an artifact of a change to the grader.
- **Fixture lint enforced at generation time**: `node infbench/generate-cases.mjs` completed with no
  lint errors, same 199-case, 7-template breakdown as `0.8.2` (`a1Lookup 30, a2ChainLen2 40,
  b1Disjoint 39, b2ChainLenK 30, b2Svf1 10, c1Cardinality 30, c2Inconsistent 20`).
- **Determinism**: same default seed (`20260707`, no `--seed` override), same case count and
  per-template breakdown as `0.8.2` — consistent with byte-identical regeneration, though the
  `--replay` byte-comparison itself was **not** re-run this cycle (it is an expensive check — a
  single full pass already took several minutes given 199 fresh `runChat()` sessions — and this is a
  measurement re-run against an already-established harness, not the stage-0 harness-validation pass
  `0.8.2` was; named honestly as not re-verified rather than silently assumed).


## Reproduce

```
npm run infbench
# or, separately:
node infbench/generate-cases.mjs --seed 20260707
node infbench/run.mjs --stamp 1.2.0
node infbench/run.mjs --stamp 1.2.0 --replay   # determinism check (slower — not re-run this cycle)
```

## Cross-check against `PLAN_INFERENCE_TESTING.md`'s own predictions (§1 "Reachable today?", §3)

- **A2 "PARTIAL" → chat now fully closes it.** §1 marked INF-A2 "PARTIAL" specifically because
  "cax-sco over two TAUGHT facts is NOT implemented" as of the plan's original writing — that gap is
  now closed (confirmed live, not just claimed by the STATUS banner), matching the plan's own later
  STATUS update, not contradicting it.
- **B1 "HALF" → still exactly half, as predicted.** §1 marked INF-B1 "HALF" ("the honest miss exists
  … `owl:disjointWith` is stored but NO rule consumes it") — this run's 33% completion (the
  `control` variant passing, `direct-member`/`lifted-member` still failing) matches that prediction
  precisely, unchanged from `0.8.2`.
- **A genuine mismatch worth flagging plainly: INF-C1's predicted shape was "NO — tier-5," i.e. an
  honest 0%-completion ceiling once/if it were ever un-gated.** What this run actually measured is
  **93% fabrication at 0% completion — the wrong FAILURE MODE**, not the predicted one. The plan's
  own risk section (§5) anticipates exactly this class of problem in the abstract ("a not-yet-
  implemented rule can coincidentally clear 50% on a small pool; the gate still holds") but does not
  anticipate a *different, unrelated, already-shipped feature* reaching into a not-yet-implemented
  band's query surface and answering it confidently wrong. That is a real, reportable mismatch
  between prediction and measurement, not a reconciled non-issue.

## Next (per `PLAN_INFERENCE_TESTING.md` §4 — not actioned this dispatch, measurement only)

- **The INF-C1 fabrication is now the more urgent of the two open problems**, ahead of stage 4
  (cardinality entailment) in practical terms: it doesn't need new entailment logic, it needs
  `GENERAL_VERB_YESNO_RE`'s no-hit branch (`src/chat.mjs:3852-3855`) to decline rather than assert
  "no" when nothing was taught under the queried predicate — independent of and cheaper than
  building real cardinality monotonicity. Left entirely unactioned here per this dispatch's scope
  (`src/chat.mjs` off-limits; a concurrent dispatch is mid-flight on `src/syllogise.mjs`).
- **Stage 3 (`cax-dw` + the ⊑-lift)** is still what INF-B1 is gating on, unchanged from `0.8.2` — 26
  of 39 B1 cases are still sitting on a real, provable "no" the engine doesn't compute yet.
- B2/C2 stay declared ceilings until stages 2 (proof-chain receipts proper)/5 respectively; C1 is no
  longer a clean ceiling and should not be re-measured as one until the fabrication above is fixed —
  re-running INFBENCH after that fix, before touching stage 4, would confirm whether C1 returns to
  its honest `0.8.2`-era ceiling on its own.
