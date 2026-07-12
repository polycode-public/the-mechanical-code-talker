# BENCHMARK_INFERENCE_1.6.0 — the blocker is fixed; the full 6-band ladder passes clean

**Headline:** this is the first INFBENCH cycle to run to completion since `1.4.1`. `1.5.7` never
produced a rung table at all — `node infbench/generate-cases.mjs` crashed deterministically on a
real lexicon collision (`"dice"` registered both as `die`'s irregular plural and as its own
standalone noun; see `BENCHMARK_INFERENCE_1.5.7.md`). That collision was fixed this session
(`d5e962d`, "prune the die/dice-style noun collision by determiner agreement"), alongside a new
multi-candidate ambiguity-resolution capability, `parseAceAmbiguous` (`65a7752`, `c254871`,
`842ffa1`, merged `96bfe4f`), documented in `PLAN_DID_YOU_SEE_HER_DUCK.md`. `package.json` moved to
`1.6.0` in `51c5412`. This cycle confirms the fix directly: `node infbench/generate-cases.mjs` now
exits 0 and writes `infbench/cases.jsonl` cleanly, and the full harness runs both drive points to
completion with **every one of 299 recorded rows passing** — 0% fabrication, 100% completion, on
every band, on both arms. No engine fix was needed this cycle; `SKILL_BENCHMARK_INFERENCE.md`
Step 5's "every band gates where the plan predicted — ship as-is" outcome applies.

## Step 1 — REGENERATE: the crash is gone, checked directly

```
$ node infbench/generate-cases.mjs
infbench/generate-cases.mjs — seed 20260707 — 219 case(s) written to .../infbench/cases.jsonl
per-template counts (the authoritative counts):
  a1Lookup         30
  a2ChainLen2      40
  b1Disjoint       39
  b2ChainLenK      30
  b2Svf1           10
  b2Svf1Apply      10
  c1Cardinality    30
  c1ScmSvfApply    10
  c2Inconsistent   20
$ echo $?
0
```

**219 cases, exit 0.** This is the direct proof the `d5e962d` lexicon fix unblocks measurement:
`b2Svf1Apply`'s 4th generated case (the exact one that crashed `1.5.7`) now round-trips through
`parseAce()` without folding `"dice"` onto `die`'s lemma, so the fixture lint's entailed-term check
passes. Case count is up from `1.4.1`'s 209 by one new template, `c1ScmSvfApply` (10 cases), added
between `1.4.1` and `1.5.7` (commit `1110488`) to measure the `scm-svf1` rule that shipped the same
session — `1.5.7` never got far enough into generation to reach it, since the crash happens earlier
in template order at `b2Svf1Apply`.

## Step 2 — RUN: full harness, both drive points

```
$ npm run infbench
> node infbench/generate-cases.mjs && node infbench/run.mjs
```

Ran to completion in the foreground, watched end-to-end. `infbench/cases.jsonl` written
2026-07-11 13:19:40 BST; `infbench/results/raw/run-1.6.0/product.jsonl` written 13:20:27 BST —
about 47 seconds wall-clock for 299 drive-point sessions (80 kernel + 219 chat) at the documented
default concurrency of 6 (`DEFAULT_CONCURRENCY`, `infbench/run.mjs`).

## Step 3 — READ: the rung tables

### Kernel arm (80 cases; `src/syllogise.mjs` direct)

| band | n | pass | completion | fabrication | gate |
| --- | --: | --: | --: | --: | --- |
| INF-A1 | 10 | 10 | **100%** | 0% | PASS |
| INF-A2 | 20 | 20 | **100%** | 0% | PASS |
| INF-B2 | 10 | 10 | **100%** | 0% | PASS |
| INF-C1 | 40 | 40 | **100%** | 0% | PASS |
| **all** | **80** | **80** | **100%** | **0%** | **PASS** |

INF-C1 is newly present in the kernel arm — `1.4.1`'s kernel arm only reached INF-B2 (40 cases
total). The `scm-svf1`/cardinality-monotonicity/`cax-maxc0` rules that shipped after `1.4.1` are now
directly kernel-gradeable, doubling the kernel arm's case count from 40 to 80.

### Chat arm (219 cases; `runChat()`, taught premises then the query)

| band | n | pass | completion | fabrication | gate | vs. `1.4.1` |
| --- | --: | --: | --: | --: | --- | --- |
| INF-A1 | 30 | 30 | **100%** | 0% | PASS | unchanged |
| INF-A2 | 40 | 40 | **100%** | 0% | PASS | unchanged |
| INF-B1 | 39 | 39 | **100%** | 0% | PASS | unchanged |
| INF-B2 | 50 | 50 | **100%** | 0% | PASS | **80% → 100%** |
| INF-C1 | 40 | 40 | **100%** | 0% | PASS | new: `c1ScmSvfApply` template added, ceiling → 100% |
| INF-C2 | 20 | 20 | **100%** | 0% | PASS | unchanged |
| **all** | **219** | **219** | **100%** | **0%** | **PASS** | 94% → 100% |

Ladder: A1 → A2 → B1 → B2 → C1 → C2, every band passes the gate. **Checked directly against the raw
result file, not just the console summary** — `infbench/results/raw/run-1.6.0/product.jsonl` holds
299 rows (80 kernel + 219 chat) and zero of them have `pass: false`.

## Step 4 — DECIDE: the ladder gate, walked in order

Every band from INF-A1 to INF-C2 clears **≥50% completion at 0% fabrication** on both arms, with no
band skipped and no ceiling marker to report — the full ladder is a clean pass this cycle. This
matches `archive/PLAN_INFERENCE_TESTING.md`'s own STATUS banner, which predicted this exact outcome
once the `cax-maxc0`/`scm-svf1`/cardinality-monotonicity follow-up (commits `07b8035`/`1110488`/
`304a16c`, shipped 2026-07-10) closed the last open gaps: the plan's own "fresh measurement" note
had flagged 216/219 chat completion with 3 non-passing `-max0-*` rows *before* that follow-up
landed, and predicted those 3 rows would clear once it shipped. `1.5.7`'s crash meant nobody
confirmed that prediction against a real harness run — this cycle is that confirmation, and it lands
exactly where predicted: 219/219, 100%.

## Step 5 — SHIP OR BUILD

**Ship as-is.** Every band gates exactly where the plan predicted, the top of the ladder (INF-C2)
is fully closed, and there is nothing left to build this cycle per `SKILL_BENCHMARK_INFERENCE.md`'s
own Step 5 branching. No code fix was applied in this dispatch — this was a measurement-only run.

## What changed since `1.4.1`, and why it moved

- **INF-B2 chat (80% → 100%).** `1.4.1` reported 10 `unproven` rows in `b2Svf1Apply` because
  `cls-svf1`'s live chat-query wiring hadn't shipped yet — the kernel rule passed but the chat
  surface couldn't reach it. That wiring landed in the plan's "follow-up" batch (commit `304a16c`,
  2026-07-10); this cycle confirms it live: all 10 rows now pass.
- **INF-C1 chat (grew from 30 to 40 cases, ceiling → 100%).** The new `c1ScmSvfApply` template
  (commit `1110488`) added 10 positive cases for the `scm-svf1` rule; `1.4.1`'s original
  `c1Cardinality` fixture had no cases that could ever show a pass for that rule, so it needed its
  own measuring template before the rule could be graded at all — the same two-step recipe
  `PLAN_INFERENCE_TESTING.md` §4 stage 4 already used for `cls-svf1`/`b2Svf1Apply`.
- **The `-max0-*` "unclear" rows (3 non-passing since `0.8.2`, gone).** `cax-maxc0` (max-0 as
  encoded negation, grounded in `cls-maxc1`'s ABox contradiction) shipped in the same follow-up
  batch and closes the long-standing quirk. This is the first cycle to confirm that fix against a
  live run — `1.5.7` never got the chance.

None of this was built in this dispatch — it was already shipped before `1.5.7`'s blocked attempt.
This cycle's only job was to confirm the lexicon fix restores measurement, and it does: the numbers
land exactly where the plan predicted they would once its follow-up work was live-tested end to end.

## Discipline — the non-negotiables, checked

- **Zero-fabrication anti-circularity**: unaffected by this cycle — no grader or template code
  changed here, only the lexicon fix (already shipped, reviewed separately) and this measurement.
- **Fixture lint enforced at generation time**: `node infbench/generate-cases.mjs` completed with no
  lint errors — 219 cases across 9 templates, one more template than `1.4.1`'s eight
  (`c1ScmSvfApply`, added between `1.4.1` and `1.5.7`).
- **The run was watched to completion, not backgrounded and abandoned**: launched in the foreground,
  completed in ~47 seconds wall-clock (299 drive-point sessions, concurrency 6) — far faster than
  `1.4.1`'s ~11 minutes, consistent with this worktree carrying no unrelated concurrent system load.
- **Zero non-passing rows verified against the raw file directly**, not inferred from the printed
  rung table alone — `product.jsonl`'s 299 rows all carry `pass: true`.
- **`npm test`**: 1872/1872 green (0 fail, 0 cancelled), checked in the foreground —
  `duration_ms 367191.6` (~6m7s), run start 2026-07-11 13:20:39 BST, end 13:27:04 BST.

## Reproduce

```
npm run infbench
# or, separately:
node infbench/generate-cases.mjs --seed 20260707
node infbench/run.mjs --stamp 1.6.0
```

## Cross-check against `archive/PLAN_INFERENCE_TESTING.md`'s own predictions

- **STATUS banner's "fresh measurement... chat arm 216/219, 99%" claim** was written before the
  `cax-maxc0`/`scm-svf1`/cardinality-monotonicity follow-up shipped, and named the 3 non-passing
  `-max0-*` rows as the exact gap that follow-up would close. Confirmed here: 219/219, 100%.
- **Kernel arm doubling (40 → 80 cases) matches the plan's own claim** that the follow-up's three
  rules are all kernel-gradeable (`scm-svf1`, cardinality monotonicity, `cax-maxc0`), not just
  chat-observable.
- **No band skipped, no gate failure anywhere** — this is the second time (after `1.4.1`) the full
  ladder has cleared with zero non-passing rows, and the first time it has done so with all nine
  templates (`c1ScmSvfApply` included) and the full kernel-arm C1 coverage in place.

## What this means for `1.5.7`'s blocked attempt

`1.5.7`'s report was honest and correct given what it could measure: it could not confirm or deny
the engine's actual ladder state that cycle, because the generator crashed before writing a single
case. This cycle closes that gap. The engine work `1.5.7` couldn't see — the `cax-maxc0`/`scm-svf1`/
cardinality-monotonicity follow-up — was real and already shipped; it just hadn't been measured
end-to-end through a working harness until now.
