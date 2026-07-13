# INFBENCH_1.3.1 — the `PLAN_TAUGHT_RELATIONS.md` completion re-run; ladder unchanged, byte-for-byte

**Headline:** first INFBENCH re-run since `1.3.0`, against the current **1.3.1** codebase (per
`package.json`; `git log` shows `chore(release): 1.3.1` immediately after `1.3.0`, followed by the
four `PLAN_TAUGHT_RELATIONS.md` phases that finished the plan's full six-item scope: Phase 2
(relation alias/union query-side chase), Phase 4 (fixed-hop `compose2` composition), Phase 5
(property-filtered composition), and Phase 6's WIRING half (recursive/reachability rule +
`findReachableSet` dispatch) — `PLAN_TAUGHT_RELATIONS.md`'s own STATUS banner now reads "**DONE
(2026-07-09) — all six items + the full storage/query dispatcher are live**"). `npm run infbench`
ran to completion cleanly, in the foreground, watched end-to-end via a blocking wait on the actual
OS process (no backgrounded-and-abandoned run) — same 199 generated cases, same default seed
(`20260707`), same seven per-template counts as `1.3.0`/`1.2.0`.

**Nothing moved. Not one band, not one case, not even the answer text.** A direct row-by-row diff
of `infbench/results/raw/run-1.3.0/product.jsonl` against `run-1.3.1/product.jsonl` (229 rows each,
keyed on `caseId|arm`) found **zero differences** in `pass`, `fabricated`, `completed`, `observed`,
or `band` — and a second pass comparing the literal `answer`/`observed` text field found **zero
differences** there either. Every one of the four new phases' recognizers and dispatch branches
(`RELATION_FACT_YESNO_RE`, `relationFactsFor`, the `compose2` Rule-dispatch path, `resolveRelation
Chase`'s `filter` branch, the `recursive` rule + `findReachableSet` wiring) fired on **zero** of the
199 cases — confirmed directly by grepping every case's `premises` array and `query` string in
`infbench/cases.jsonl` for the phrasings those phases actually recognize ("is the father of",
"is a parent of", "grandparent"/"grandfather", "descendant", "is bespoke"): **0 matches** across all
199 premises and all 199 queries. INFBENCH's seven templates (`a1Lookup`, `a2ChainLen2`,
`b1Disjoint`, `b2ChainLenK`, `b2Svf1`, `c1Cardinality`, `c2Inconsistent`) generate only
class-membership ("is a X a Y"), cardinality ("does every X have at least/at most N Y"), and
disjointness/inconsistency phrasing — none of the generator's templates produce or ever produced
the relational-fact-teach surface the new phases extend, so the new machinery is structurally
unreachable from this benchmark's case pool, not merely coincidentally unexercised this run.

**The ladder still gates at INF-B1** (33% completion, unchanged across four consecutive measured
versions now — `0.8.2`, `1.2.0`, `1.3.0`, `1.3.1`), so nothing here changes what ships this cycle.

## The metric pair, per band — KERNEL arm (30 cases; A1/A2 only, same scoping as prior runs)

`node infbench/run.mjs` (raw: `infbench/results/raw/run-1.3.1/product.jsonl`)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| **all** | **30** | **30** | **100%** | **0%** | **PASS** |

Unchanged from `1.3.0`/`1.2.0`. The kernel prover doesn't see `chat.mjs`'s query lanes (or the new
`PLAN_TAUGHT_RELATIONS.md` Rule-dispatch code) at all, so it was never going to move this cycle.

## The metric pair, per band — CHAT arm (199 cases; `runChat()`, taught premises then the query)

| band | n | pass | completion | fabrication | gate | vs. `1.3.0` |
| --- | --: | --: | --: | --: | --- | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS | unchanged |
| INF-A2 | 40 | 40 | **100%** | 0% | PASS | unchanged |
| INF-B1 | 39 | 13 | **33%** | 0% | **FAIL — gates the ladder here** | unchanged |
| INF-B2 | 40 | 40 | 100% | 0% | skipped (gated by INF-B1) | unchanged |
| INF-C1 | 30 | 28 | **93%** | 0% | skipped (gated by INF-B1) | unchanged |
| INF-C2 | 20 | 0 | 0% | 0% | skipped (gated by INF-B1) | unchanged |
| **all** | **199** | **151** | **76%** | **0%** | n/a — ladder-gated | unchanged |

Ladder: A1 → A2 → B1 → B2 → C1 → C2, **gated at INF-B1 completion 33% < 50%** — the same gate point
as `1.3.0`/`1.2.0`/`0.8.2`. B2/C1/C2 remain reported skipped-with-a-receipt exactly as before.

The 48 non-passing rows are the exact same 48 case IDs as `1.3.0`: `inf-b1-disjoint-direct-member-
001..013` + `inf-b1-disjoint-lifted-member-001..013` (26), `inf-c1-card-max0-009`/`-014` (2, the
long-standing "unclear" quirk), and `inf-c2-inconsistent-inconsistent-001..020` (20, the C2 ceiling).

## Did the new taught-relations/rule-composition work move ANY band? — checked directly, not guessed

**No. Confirmed two ways, both against the actual per-case results, not surface similarity:**

1. **Row-by-row diff of the two runs' raw product files.** `run-1.3.0/product.jsonl` and
   `run-1.3.1/product.jsonl` both have 229 rows (30 kernel-arm A1/A2 cases + 199 chat-arm cases).
   Keying both files on `caseId|arm` and comparing `{pass, fabricated, completed, observed, band}`
   for every key produces **zero diffs** — literally every case's pass/fail, completion, and
   fabrication verdict is byte-identical between the two versions. A second comparison pass over the
   literal `answer` (chat arm) / `observed` (kernel arm) text field, again keyed the same way, also
   found **zero diffs** — meaning not one case's answer wording changed either, which rules out even
   a "different code path fired but produced coincidentally the same verdict" scenario.
2. **INF-B1 was the specific candidate this task flagged for close inspection** ("is about
   disprovable/unprovable membership claims — the new machinery's 'honest decline when a chain can't
   be found' behavior is at least plausibly related"). Checked directly: INF-B1's 39 cases are
   `b1Disjoint` template cases — two disjoint classes, then "is `X` a `Y`" where the honest answer is
   a provable "no" the engine can't yet derive (`cax-dw`, stage 3, still unbuilt). The 26 failing
   cases (`direct-member`/`lifted-member`, 13 each) are the exact same 26 case IDs that have failed
   this same way across `0.8.2`, `1.2.0`, `1.3.0`, and now `1.3.1` — the `control` variant (13 cases,
   not shown as failing) still passes, unchanged. Tracing why: `b1Disjoint`'s premises are plain
   `rdfs:subClassOf` + disjointness declarations over class nouns (e.g. "a process is disjoint from
   an output"), and its query is a plain "is X a Y" class-membership question — it never teaches or
   queries a relation (a two-argument predicate between two individuals/classes, the surface Phase
   2/4/5/6 extend), so there is no relation-alias, no `compose2` chain, no property-filter, and no
   recursive/reachability rule for the new dispatch code to even attempt. INF-B1's honest-decline
   behavior (`unproven` instead of the provable `no`) comes from a completely separate code path —
   `ISA_ASK_RE`'s existing class-hierarchy walk not consulting disjointness axioms at all yet — that
   predates every one of the four new phases and shares no function, regex, or Rule-storage record
   with them. The surface-level resemblance ("honest decline when the engine can't complete a proof")
   the task flagged as plausible is real at the *behavioral* level (both are "decline rather than
   fabricate") but not at the *mechanism* level — confirmed by reading the actual `b1Disjoint`
   fixtures and cross-referencing against `PLAN_TAUGHT_RELATIONS.md`'s own recognizers, not inferred
   from the identical numbers alone.
3. **Direct fixture-level check, not just band-level inference.** Every one of `infbench/cases.jsonl`'s
   199 `premises` arrays and 199 `query` strings was grepped for the phrasings the four new phases'
   recognizers actually match (relational-fact-teach: "is the father of"/"is the X of"; alias/union:
   "is a parent of"; `compose2`: "grandparent"/"grandfather"; property-filter: "is bespoke"; recursive:
   "descendant"). **Zero matches**, across every field, in every case. `b1Disjoint` (and every other
   template) generates only ISA/cardinality/disjointness phrasing built from `CLASS_NOUNS`/
   `OBJECT_PROPERTY_NOUNS` word lists (`infbench/generate-cases.mjs`) — none of the seven templates
   were changed, and none happen to reach the new relational surface incidentally.

**Conclusion:** the four `PLAN_TAUGHT_RELATIONS.md` phases that shipped since `1.3.0`'s measurement
add a genuinely new capability (teaching and querying arbitrary two-argument relations, alias/union
over them, fixed-hop and property-filtered composition, and recursive/reachability enumeration) on a
part of `chat.mjs`'s dispatch surface that INFBENCH's generator never touches. This is not a gap in
either piece of work — INFBENCH is purpose-built to measure a specific closed six-band classical-
logic ladder (class membership, cardinality, disjointness, consistency) that predates and is
independent of the relations/rules surface `PLAN_TAUGHT_RELATIONS.md` adds. "No measurable effect on
any INFBENCH band" is the honest, correct, and expected result of this re-run, not a null finding to
be explained away.

## Scope decisions (unchanged from `1.3.0`/`1.2.0`)

- **The kernel arm only runs where its actual domain matches the question**: `a1Lookup/subClassOf`
  and `a2ChainLen2/taught-only` remain the only templates whose query is a pure class-to-class
  `rdfs:subClassOf` question; every other template declares `arms: ["chat"]` only.
- **INF-B2/C1/C2's `expect.verdict` is still pinned to the honest ceiling** (`"unproven"`/
  `"inconsistent"`) by construction, not to the raw classical truth-value — unchanged.
- **Proof receipts (`expect.proof`) are still recorded but not actively graded** — unchanged.

## Discipline — the non-negotiables, checked

- **Zero-fabrication anti-circularity**: confirmed unaffected — every `expect` literal in
  `infbench/cases.jsonl` is a pure function of its own template parameters; `infbench/grade.mjs` and
  `infbench/generate-cases.mjs` are untouched by any commit since the harness landed (still true as
  of this run — `git log -- infbench/` shows no commits since the harness's original landing plus
  its two `INFBENCH_*.md` write-ups, neither of which touches the generator/grader code).
- **Fixture lint enforced at generation time**: `node infbench/generate-cases.mjs` completed with no
  lint errors, same 199-case, 7-template breakdown as `1.3.0`/`1.2.0`/`0.8.2` (`a1Lookup 30,
  a2ChainLen2 40, b1Disjoint 39, b2ChainLenK 30, b2Svf1 10, c1Cardinality 30, c2Inconsistent 20`).
- **Determinism**: same default seed (`20260707`, no `--seed` override), same case count and
  per-template breakdown — a genuine apples-to-apples comparison against `1.3.0`'s run, confirmed by
  the byte-identical `product.jsonl` row comparison above (not merely assumed from matching counts).
  The `--replay` byte-comparison itself was **not** re-run this cycle (same reasoning as prior
  reports: an expensive check on top of an already multi-minute 199-case `runChat()` sweep, and this
  is a routine re-measurement, not a stage-0 harness-validation pass).
- **The run was watched to completion, not backgrounded and abandoned**: `npm run infbench` was
  launched; when the harness reported it running in the background, a second command was armed that
  blocked on the actual OS process ID (`until ! ps -p <pid>; do sleep 5; done`) until it exited,
  and only then was the full console output (per-band tables + the 48-row non-passing list) read in
  full and used to write this report — no number here was taken from a still-running or assumed
  outcome.

- **HANDOVER.md/ROADMAP.md bullet**: added — one short dated bullet to each file's main narrative
  (not touching HANDOVER's numbered "Open follow-ups" list), since `git status` showed both files
  clean immediately before editing.

## Reproduce

```
npm run infbench
# or, separately:
node infbench/generate-cases.mjs --seed 20260707
node infbench/run.mjs --stamp 1.3.1
node infbench/run.mjs --stamp 1.3.1 --replay   # determinism check (slower — not re-run this cycle)
```

## Cross-check against `PLAN_INFERENCE_TESTING.md`'s own predictions (§1 "Reachable today?", §3)

- **B1 "HALF" → still exactly half, unchanged for the FOURTH consecutive measured version**
  (`0.8.2`, `1.2.0`, `1.3.0`, `1.3.1` all land at 33% completion, `control` variant passing,
  `direct-member`/`lifted-member` still failing on the same 26 case IDs each time).
- **INF-C1 remains the clean 93%/0% ceiling** `1.3.0`'s fix confirmed — unaffected by this cycle's
  new relational/rule-composition work, exactly as predicted (a different surface, not a rung this
  ladder measures).

## Next (per `PLAN_INFERENCE_TESTING.md` §4 — not actioned this dispatch, measurement only)

- **Stage 3 (`cax-dw` + the ⊑-lift)** is still what INF-B1 is gating on, unchanged across four
  measured versions now — 26 of 39 B1 cases are still sitting on a real, provable "no" the engine
  doesn't compute yet. This remains the single highest-leverage next build stage on the ladder, and
  is completely independent of `PLAN_TAUGHT_RELATIONS.md`'s now-complete six-item scope.
- **INF-C1 is a clean ceiling** and should be treated as such (skipped-with-a-receipt behind the B1
  gate) until stage 4 (cardinality entailment) is actually built.
- The `-max0-009`/`-014` "unclear" quirk remains open, low-priority, and unchanged across four
  versions — still not blocking anything on the ladder.
- **If a future cycle wants INFBENCH to actually exercise `PLAN_TAUGHT_RELATIONS.md`'s surface**,
  that requires new generator templates (relational-fact teach/query, alias, `compose2`,
  property-filter, recursive/reachability) — a deliberate scope decision for a future dispatch, not
  a gap in this measurement.
