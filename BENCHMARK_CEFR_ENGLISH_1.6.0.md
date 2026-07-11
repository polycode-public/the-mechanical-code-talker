# BENCHMARK_CEFR_ENGLISH_1.6.0 — flat re-measurement, both 1.5.7 weak spots confirmed untouched by the ambiguity fix

**Headline:** CEFR_ENGLISH re-run against **1.6.0** (per `package.json`), following
`SKILL_BENCHMARK_CEFR_ENGLISH.md`'s cycle. Like `1.5.7`'s own report, this is a **catch-up
measurement, not a single-lever cycle**: no lever was applied to this benchmark's case pool this
session. The real news between `1.5.7` and `1.6.0` is `PLAN_DID_YOU_SEE_HER_DUCK.md`'s
multi-candidate ambiguity resolution (`lookupNounCandidates`/`lookupVerbCandidates`/
`parseAceAmbiguous`, merged at `96bfe4f`) — this run exists to check, empirically, whether that
work shows up in graded chat quality.

**Result: mean 1.710 / 2 (down from 1.5.7's 1.724, a 0.014-point wobble), 1 hard fail out of 109
cases (0.9%, unchanged), 0 voided samples, tier-1 108/109 (unchanged).**

**Decision rule (§1): the mean is not up, so by the letter of the rule this catch-up cycle does not
PASS.** But it is also not a regression in the sense the rule exists to catch: the same single case
is the tier-1 fail (`am-tests-cover`) and the same single case is the hard fail (`g-a1-naming-9`) as
`1.5.7` — no previously-passing case crossed into fail, no new hard fail appeared. The 0.014-point
drop sits inside ordinary single-draw judge noise (this profile runs N=2, single draw, no dual-draw
reliability check — see `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1); several per-cell means moved both up
and down by comparable amounts with no code change behind them (see "What moved" below). Read this
as **flat**, not **down**.

## Provenance — recovered from a stalled prior attempt, not freshly run by this session

The product run and judge pass (218 real judge calls, `claude-haiku-4-5-20251001` @
`judge-prompt-v1`) were executed by an earlier agent attempt at this exact benchmark. That attempt
completed the real work but went idle before writing the report or committing, and its worktree was
subsequently lost. The coordinator recovered the raw output (`judged.jsonl`, `product.jsonl`,
`summary.json`, `timings.json`) before the worktree was gone. This session copied those files into
`chatbench/results/raw/run-1.6.0/`, verified them intact (line counts: 218 judge rows = 109 cases ×
2 samples, matching `summary.json`'s `samplesPerCase: 2`; 109 product rows; both files fully
JSON-parseable line-by-line; `jq . summary.json` / `jq . timings.json` both clean), and wrote this
report from that recovered data. **No product or judge call was re-run by this session.**

**Timing — honestly incomplete.** `1.5.7`'s report cited real file-mtime timestamps for product-run
and judge-run start/end. That's not reproducible here: the recovery copy stamped all four recovered
files with the same mtime (`2026-07-11 14:02:31 BST`), so the original per-stage wall-clock
boundaries are gone. What *does* travel with the data itself:

| stage | value | source |
| --- | --- | --- |
| product-run wall time | **818.38ms** | `timings.json`'s `wallMs` |
| judge calls | 218 (109 cases × 2 samples) | row count, `judged.jsonl` |
| judge compute, summed per-call `duration_ms` | 7,350.46s (≈122.5 CPU-minutes) | summed from each row's embedded `raw.duration_ms` |
| judge wall time, estimated at concurrency 12 | ≈612s (**≈10m12s**) | 7,350.46s ÷ 12 — an estimate from summed compute, not a measured wall-clock span |
| recovery-copy mtime (all 4 files) | 2026-07-11 14:02:31 BST | filesystem, post-recovery |

The estimated ~10m12s judge wall time is the same order of magnitude as `1.5.7`'s directly-measured
~12m10s for the same shape of run (109 cases, N=2, concurrency 12), which is the best available
cross-check that this is a real, complete run and not a partial or corrupted one.

**Commit pin — also honestly bounded, not exact.** `summary.json` stamps `"stamp": "1.6.0"`, and the
case content matches the unchanged 109-case `graded-pool.jsonl` pool, so the run postdates `51c5412`
(the `1.6.0` version bump) and `96bfe4f` (the ambiguity merge) on `main`'s history. The lost worktree
that produced it can't be pinned to an exact SHA — it was already gone by the time this session
started. The recovery-copy mtime (14:02:31 BST) falls between `main`'s `607fb26` (13:59:24 BST,
"drop the stale-worktree-branches item") and `47ecc2e` (14:03:40 BST, "condense ROADMAP.md"), which
brackets, but does not pin, when the original run finished. This session's own worktree fast-forward
to `main` landed at `47ecc2e993346f1d55b17fa290cc2d838c65ad54` before this report was written; that
is the exact commit this write-up (and the `npm test` count below) is pinned to, distinct from the
(unrecoverable) exact commit the original benchmark run executed against.

## Deterministic tier-1 (free, run first)

109 cases, single draw (matches the recovered `product.jsonl`'s `sampling.draw: "single"` on every
row).

| band | n | tier-1 green | frontier |
| --- | --: | --: | --: |
| A1 | 27 | 27 | 0 |
| A2 | 19 | 19 | 0 |
| B1 | 33 | 32 | 1 |
| B2 | 10 | 10 | 0 |
| C1 | 10 | 10 | 0 |
| C2 | 10 | 10 | 0 |
| **all** | **109** | **108/109 tier-1 pass** | |

The single tier-1 fail is `am-tests-cover` (B1 `svo-query`, tagged `ambiguity`) — **the same case,
same failure mode, as 1.5.7**: "which tests cover b.mjs" resolves confidently to
`app/unit-tests/b.test.mjs.` instead of flagging that `b.mjs` matches both `app/lib/b.mjs` and
`app/unit-tests/b.test.mjs` and asking the user to narrow. Verbatim transcript checked against this
run's own `product.jsonl` — byte-identical to the answer `1.5.7`'s report recorded. Unchanged across
three straight measured cycles now (`1.4.1`, `1.5.7`, `1.6.0`).

## Judged tier (the paid step — N=2, single draw, `claude-haiku-4-5-20251001` @ `judge-prompt-v1`)

Raw: `chatbench/results/raw/run-1.6.0/judged.jsonl` + `summary.json` (recovered, see Provenance).

| metric | value |
| --- | --- |
| cases judged | 109 |
| samples/case | 2 (218 total judge calls) |
| overall mean | **1.710 / 2** (1.5.7: 1.724) |
| hard fails | **1** (0.9%) (1.5.7: 1, same case) |
| voided samples | **0** |
| tier-1 pass count | 108 / 109 (same as 1.5.7) |

### Per-tag breakdown

| tag | cases | mean | hard fails | 1.5.7 mean | Δ |
| --- | --: | --: | --: | --: | --: |
| conversational | 6 | 2.000 | 0 | 2.000 | 0 |
| bootstrap-empty | 2 | 2.000 | 0 | 2.000 | 0 |
| noise | 5 | 1.967 | 0 | 1.900 | +0.067 |
| multi-turn-focus | 5 | 1.900 | 0 | 1.900 | 0 |
| graph-query | 16 | 1.771 | 0 | 1.813 | −0.042 |
| typo-fuzzy | 4 | 1.771 | 0 | 1.875 | −0.104 |
| memory-recall | 3 | 1.750 | 0 | 1.833 | −0.083 |
| honesty-miss | 5 | 1.433 | 0 | 1.600 | −0.167 |
| ambiguity | 4 | 1.313 | 0 | 1.188 | +0.125 |
| **graded (all 109)** | **109** | **1.710** | **1** | **1.724** | **−0.014** |

No tag crossed into or out of a hard fail. Every folded-in former-core tag stays clean (0 hard
fails), same as `1.5.7`. The largest single-tag move (`honesty-miss`, −0.167 over 5 cases — one
sample's worth of scoring at this N) and the largest positive move (`ambiguity`, +0.125 over 4
cases) both sit well inside what N=2 single-draw judging can swing on repeat, per
`SKILL_BENCHMARK_CEFR_ENGLISH.md` §1's own caveat that dual-draw is the tool for distinguishing real
movement from judge noise — not run here, since this is a catch-up measurement, not a release gate.

### Per-grade / per-construction cell rollup (judged mean)

| grade | construction | n | 1.6.0 mean | 1.5.7 mean | Δ | hard fails |
| --- | --- | --: | --: | --: | --: | --: |
| A1 | naming-vocabulary | 10 | 1.512 | 1.475 | +0.037 | 1 |
| A1 | svo-query | 17 | 1.833 | 1.824 | +0.009 | 0 |
| A2 | assert-recall | 9 | 1.917 | 1.944 | −0.027 | 0 |
| A2 | naming-vocabulary | 10 | 1.837 | 1.863 | −0.026 | 0 |
| B1 | discourse-reference | 5 | 1.900 | 1.900 | 0 | 0 |
| B1 | negation | 5 | 1.433 | 1.600 | −0.167 | 0 |
| B1 | noise+svo-query | 5 | 1.967 | 1.900 | +0.067 | 0 |
| B1 | pronoun-binding | 10 | 1.625 | 1.600 | +0.025 | 0 |
| B1 | svo-query | 8 | 1.542 | 1.531 | +0.011 | 0 |
| B2 | reversible-passive | 10 | 1.850 | 1.850 | 0 | 0 |
| C1 | temporal | 10 | 1.400 | 1.425 | −0.025 | 0 |
| C2 | pronoun-binding | 10 | 1.688 | 1.800 | −0.112 | 0 |

Every cell's movement is within a couple of samples' worth of judge noise; none crosses a
pass/fail line, and — checked directly against this run's own `product.jsonl` transcripts — the
answers behind the biggest movers (`B1 negation`, `C2 pronoun-binding`) read byte-identical to what
`1.5.7`'s own evidence section quoted (e.g. `g-c2-pron-9` below is unchanged verbatim). The product
is deterministic; only the judge's scoring wobbled.

### The 1 hard fail

| case | tags | mean | groundedness | correctness | honesty | rephrase |
| --- | --- | --: | --: | --: | --: | --: |
| `g-a1-naming-9` | A1 naming-vocabulary | 0.500 | 1.0 | 0 | 0 | 1 |

**"what does imports mean"** → *"this could mean more than one thing: 1) meta "imports" or 2)
imports "mean" — try rephrasing more specifically."* Same case, same wording, same answer as
`1.5.7`. The raw mean dropped slightly (0.625 → 0.500): in `1.5.7` the two judge samples'
`groundedness` averaged 1.5; this run's two samples averaged 1.0 (both `correctness`/`honesty`
stayed pinned at 0 either way — the case was already a hard fail in `1.5.7`, and stays one here).
This is judge-sample noise on an already-known weak spot, not a new regression: the product's answer
text did not change.

## What moved since 1.5.7 — and what didn't

**Nothing here is traceable to a shipped commit, because no commit between `1.5.7` and `1.6.0`
targets this benchmark's case-set surface.** The intervening work
(`d5e962d`/`65a7752`/`c254871`/`842ffa1` — `PLAN_DID_YOU_SEE_HER_DUCK.md`'s ambiguity resolution;
`4ae481b` — `BENCHMARK_INFERENCE_1.6.0`; the capability-audit docs) targets the lexicon/parse layer
and the INFBENCH reasoning ladder, not the CEFR chat-quality pool. Checked directly (not assumed):

- Every per-tag and per-cell delta above is small (largest single move: −0.167, one B1 `negation`
  cell over 5 cases) and goes **both directions** — `ambiguity` and `noise` moved *up*, `honesty-miss`
  and `C2 pronoun-binding` moved *down* — the signature of judge-sampling variance, not a directional
  product regression.
- The two named weak spots (`am-tests-cover`, `g-a1-naming-9`) are **the same two cases**, same
  failure mode, in both cycles.
- Grepped this run's own `product.jsonl`: none of the 109 cases' turn text contains any word the
  ambiguity fix touches (`duck`, `mock`, `senior`, `dice`, `tooth`, `teeth`), and a scan of every
  non-question, non-command turn across all 109 cases finds zero Pattern-3 declarative "N1 VERB N2."
  teach statements — the shape `parseAceAmbiguous`/`assertTurn`'s new branch requires. The pool's
  declarative-looking turns are all either commands (`/describe`, `/focus`), discourse-anaphora
  queries ("... — which of them ..."), or bare entity names (`am-bare-name`: `"Widget"`), none of
  which route through `assertTurn`'s new check.
- `am-tests-cover`'s failure runs through `resolveObject`'s entity-tie-breaking in `src/ask.mjs`,
  never through `lookupNounCandidates`/`parseAceAmbiguous` in `src/grammar/`. `g-a1-naming-9`'s
  failure runs through `ask.mjs`'s pre-existing `ambiguousParse`/`metaFallbackEntityAnswer` path (a
  question, never routed through `assertTurn` at all — that branch only fires on declarative TEACH
  sentences).

**Conclusion: this empirical re-measurement confirms `CAPABILITIES_1.6.0.md`'s §2 synthesis, and I
agree with it.** That doc reached its "the CEFR pool structurally cannot exercise the new ambiguity
capability, and neither of CEFR's two weak spots is the same bug class as the fix" conclusion by
static code/pool inspection, before this run existed. Running the actual benchmark and reading the
actual case-level judged output lands on the same answer by a different route: no case's outcome
changed in a way attributable to the ambiguity fix, both weak-spot cases are provably unreached by
the new code path (by grep, by transcript, and by dims/mean comparison), and the small mean movement
that did happen is judge noise scattered across unrelated cells, not a directional signal from any
shipped change.

## Discipline — the non-negotiables, checked

- **No LLM in the product** — the judge lives only in the eval harness; `chat.mjs`/`runTurn` stayed
  no-LLM throughout, per `CLAUDE.md`'s standing rule. This session touched no product code at all
  (docs-only).
- **Judge model + prompt version pinned**: `claude-haiku-4-5-20251001` @ `judge-prompt-v1`, recorded
  in the recovered `summary.json`, matching `1.5.7`'s pin exactly.
- **Judge integrity**: 0 voided samples — no refusal/format failure in the recovered run.
- **Determinism (tier-1)**: single product run, single draw, per the case-set v3 default (confirmed
  via `product.jsonl`'s own `sampling.draw: "single"` field on every row).
- **Case set unchanged**: still the same 109-case `graded-pool.jsonl` (append-only, sacred per §4) —
  no case added, edited, or removed since `1.5.7`.
- **`npm test`**: **1872/1872 green**, run by this session at `47ecc2e993346f1d55b17fa290cc2d838c65ad54`
  (this report's commit pin — see "Commit pin" above for why it differs from the unrecoverable exact
  commit the original benchmark run executed against). Up from `1.5.7`'s pinned 1866/1866 — the
  37-commit gap between the two pins (`08d0d034`..`47ecc2e9`) added tests (the ambiguity-resolution
  work, the two conversation round tests) without breaking any existing one.
- **No re-run of product or judge by this session** — see Provenance above; this write-up is
  transcription and analysis of already-obtained, verified-intact results, not a fresh measurement.

## Predictions-vs-actuals

No lever-specific prediction was made for CEFR this session (no lever targeted this pool). The one
standing prediction on record is `CAPABILITIES_1.6.0.md` §2's own: "no CEFR case structurally
exercises `parseAceAmbiguous`; no regression expected; a fresh run should confirm this empirically."

| prediction | actual |
| --- | --- |
| No regression from the ambiguity fix (`CAPABILITIES_1.6.0.md` §2) | **confirmed** — same 1 hard fail, same 1 tier-1 fail, same two case ids, mean flat within judge noise |
| CEFR pool cannot exercise the new `assertTurn`/`parseAceAmbiguous` branch (`CAPABILITIES_1.6.0.md` §2, static check) | **confirmed empirically** — zero Pattern-3 declaratives and zero fix-relevant vocabulary in any of the 109 cases' actual turn text, checked directly against this run's `product.jsonl` |
| `1.5.7`'s decision-log item 1 (A1 `naming-vocabulary`'s schema-term/common-word collision, `g-a1-naming-8/9`) | **not picked up this session** — still open, still the right next lever for `g-a1-naming-9` specifically (see Decision log) |

## Per-lever analysis

Not applicable in the single-lever sense (§0) — no lever targeted this benchmark's case set this
session. The only substantive product change in the `1.5.7`→`1.6.0` window
(`PLAN_DID_YOU_SEE_HER_DUCK.md`'s ambiguity resolution) is confirmed, by direct case-level check, to
land outside this pool's reach — see "What moved since 1.5.7" above.

## Decision log — ranked menu for the next cycle

Unchanged from `1.5.7`'s own ranking — nothing this cycle found reason to reorder it, since no lever
touched this pool:

1. **A1 `naming-vocabulary`'s schema-term/common-word collision** (`g-a1-naming-8/9`: "what does
   tests/imports mean") — still the most concrete, cheapest target on the board, and still this
   cycle's sole hard fail. Same *class* of bug as the already-fixed A2 cell, one tier down; the A2
   fix (`07f4805`) widened `ask.mjs`'s meta-fallback entity-class lookup, but these two bare-noun
   "what does X mean" forms hit a different, still-untouched path. **Pick for next cycle.**
2. **`am-tests-cover`'s ambiguity miss** — "which tests cover b.mjs" should flag the `b.mjs` name
   collision between `app/lib/b.mjs` and `app/unit-tests/b.test.mjs` and ask the user to narrow;
   instead it resolves confidently to one. Unchanged since `1.4.1` (three cycles now without
   movement) — worth promoting if item 1 doesn't fully absorb next session's budget. Note per
   `CAPABILITIES_1.6.0.md`'s own scoping: the closer fix shape for this specific case is
   `PLAN_CONVERSATION.md`'s own Finding 2 (the `noise-strip.mjs` breadth-first extension), not
   anything already shipped in `PLAN_DID_YOU_SEE_HER_DUCK.md`.
3. **A dual-draw or full-pool run** before the next release — this cycle's ±0.1-magnitude per-cell
   wobble is exactly the noise dual-draw's parallel-forms check exists to separate from real signal;
   worth doing once a real lever is applied to this pool, so movement is attributable rather than
   guessed-at from a single N=2 draw.
4. **New CEFR case(s) modeled on `PLAN_DID_YOU_SEE_HER_DUCK.md`'s own worked example** ("senior duck
   mock module") — the only way to make this benchmark capable of scoring the new ambiguity
   capability at all, since the current pool structurally cannot reach it (confirmed this cycle). A
   scope decision for a future cycle, not a gap in this run.

## Reproduce

```
node chatbench/run.mjs --stamp 1.6.0 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-1.6.0/product.jsonl --samples 2 --concurrency 12
```

## Evidence / transcripts (discriminating first)

**1. The hard fail — `g-a1-naming-9` (A1 naming-vocabulary), unchanged from 1.5.7:**
```
Q: what does imports mean
A: this could mean more than one thing: 1) meta "imports" or 2) imports "mean" — try rephrasing
   more specifically.
```
*What this demonstrates:* the one remaining hard fail, byte-identical to `1.5.7`'s answer — a
schema-predicate name ("imports") colliding with an ordinary English word. Confirmed this cycle to
be a different bug class from the ambiguity fix (see "What moved" above); still this cycle's top
decision-log pick.

**2. The tier-1 fail — `am-tests-cover` (B1 svo-query/ambiguity), unchanged from 1.5.7:**
```
Q: which tests cover b.mjs
A: app/unit-tests/b.test.mjs.
```
*What this demonstrates:* `b.mjs` genuinely matches two entities (`app/lib/b.mjs` and
`app/unit-tests/b.test.mjs`); still resolves confidently to one instead of flagging the collision.
Confirmed this cycle to run through `resolveObject`'s entity tie-breaking, never through the new
`lookupNounCandidates`/`parseAceAmbiguous` code path.

**3. `g-c2-pron-9` (C2 pronoun-binding) — the cell with the largest mean movement this cycle
(1.800 → 1.688), and the answer is unchanged:**
```
Q: app/unit-tests/b.test.mjs must not be deleted because it covers app/lib/b.mjs — which of them
   covers app/lib/b.mjs
A: app/unit-tests/b.test.mjs.
```
*What this demonstrates:* the product's answer is byte-identical to `1.5.7`'s. The cell's judged
mean moved on judge-sample noise alone, not on any change in behavior — direct proof that this
cycle's per-cell wobble is measurement noise, not product drift.

**4. `mt-focus-drift` (B1 discourse-reference) — a 3-turn focus chain, still clean:**
```
Q: /describe app/lib/a.mjs
A: app/lib/a.mjs — Module (id: mod-a); attestation: touched by 2 commit(s); attribute: dotted =
   app.lib.a; edges: defines → fnAlpha; cochange → app/lib/b.mjs, app/lib/c.mjs; ← imports by
   app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs; ← calls by scripts/g.mjs; ← touches by abc1234;
   provenance: git:abc1234, git:def5678

Q: what calls it
A: scripts/g.mjs.

Q: which modules import it
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```
*What this demonstrates:* focus threads correctly across three turns via the bare pronoun "it",
unchanged behavior from `1.5.7`.

**5. `mr-asked-before` (A2 assert-recall) — cross-session memory recall, still clean:**
```
Q: which modules import a.mjs
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.

Q: what did i ask before
A: last time (session 019f512e, 2026-07-11) you asked: "which modules import a.mjs"
```
*What this demonstrates:* an explicit recall query correctly cites a real session id, real date, and
the verbatim prior question — grounded in the memory graph, not fabricated. (The session id differs
from `1.5.7`'s quoted example because each run mints its own session — expected, not a behavior
change.)

**6. `tf-wat-calls` (B1 svo-query) — typo repair, still clean:**
```
Q: wat calls fnAlpha
A: in app/lib/b.mjs there is function Widget.render().
```
*What this demonstrates:* "wat" → "what" typo tolerance holding through a full graph-query answer,
unchanged from `1.5.7`.
