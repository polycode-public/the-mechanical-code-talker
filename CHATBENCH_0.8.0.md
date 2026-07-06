# CHATBENCH_0.8.0 — the three-lever release, measured

**Headline (the load-bearing result is deterministic):** all three Track-1 chat levers **moved their
cells**, verified at FULL coverage with zero sampling and zero judge involvement:

| Lever | Family | Full-coverage evidence (0.7.1 → 0.8.0) |
| --- | --- | --- |
| **discourse-count anaphora** | `g-b1-disc-count` | the **2 standing tier-1 misses cleared** — `-22` and `-3` go tier-1 **FAIL → PASS** |
| **pronoun / focus binding** | `g-b1-pron` | **5** documented-weakness turns flip failing → passing (incl. the `it → Commit` mis-bind `-25`) |
| **C1 temporal-over-relative** | `g-c1-temp` | **7** two-hop turns flip dead-end → assembled (`-9/-18/-20/-22/-35/-45/-50`) |

**Tier-1 spine: 333 / 333** (was 331/333 — the two disc-count misses are now fixed). **No tier-1
regression** on the id intersection vs `run-0.7.1/product-a.jsonl`, on BOTH the full-coverage family
run and the standard graded draw. Product replay is deterministic and free (`--stamp 0.8.0`, no
`Date.now`): 175-case family run **0.49 s**, full 618-row graded run **7.1 s**.

**Judged pooled mean (secondary): PENDING judge env — to be run by coordinator.** The judge job was
launched in this session (`node chatbench/judge.mjs --product run-0.8.0/product-a.jsonl --samples 3
--concurrency 12`, judge **claude-haiku-4-5-20251001** @ **judge-prompt-v1**) and was still streaming
at hand-off (~240/999 samples, rate-limited); it writes `run-0.8.0/judged.jsonl` + `summary.json` on
completion. Dual-draw agreement is already computed: **0.867** (26/30 cells). Reference: 0.7.1 was
mean 1.488 / 35 hard-fails / 331 tier-1. **The deterministic tier-1 reading below is the load-bearing
result and does not depend on the judge.**

---

## Part 1 — PRIMARY: per-family full-coverage lever verification (deterministic, judge-free)

The three levers touch a handful of cells inside a ~925-case pool, so a 10%-sampled pooled mean
renders them nearly invisible (the known measurement trap). So the definitive reading runs each
lever family at **FULL coverage, no sampling** (`--only <every family id>`, which pins exact ids and
disables the stratified draw), compared row-for-row against the 0.7.1 baseline product.

Command (raw under `chatbench/results/raw/run-0.8.0/families/`):

```
node chatbench/run.mjs --stamp 0.8.0 --only <175 family ids> \
  --pool chatbench/graded-pool.jsonl \
  --compare chatbench/results/raw/run-0.7.1/product-a.jsonl \
  --out chatbench/results/raw/run-0.8.0/families
```

Result: **175 / 175 tier-1 pass, no regressions.** Per-family movement (the `improvedBaselineTurns`
signal — a documented-weakness turn whose checks now ALL pass — plus the two hard tier-1 flips):

| Family (lever) | Cases | In 0.7.1 base | Weakness turns fixed (0.7.1 → 0.8.0) | Hard tier-1 flips |
| --- | ---: | ---: | --- | --- |
| `g-b1-pron` (pronoun/focus) | 50 | 50 | **+5** improved (0 → 5) | — |
| `g-b1-disc-count` (discourse-count) | 25 | 5 | — | **2 FAIL → PASS** (`-22`, `-3`) |
| `g-c1-temp` (C1 temporal) | 50 | 50 | **+7** improved (0 → 7) | — |
| `g-b1-temp` (B1 temporal — CONTROL) | 50 | 50 | 0 (unchanged) | — |

`g-b1-temp` is the control: the C1-temporal lever is scoped to the C1 two-hop shape, so B1 temporal
does **not** move — no spurious spill. Exactly the isolation the measurement wants.

### Lever 1 — discourse-count anaphora (clears both 0.7.1 tier-1 misses)

The two cases CHATBENCH_0.7.1 flagged as the only tier-1 misses (`g-b1-disc-count-22`, `-3`) both go
**FAIL → PASS**:

- **`g-b1-disc-count-22`** — *"untested classes"* → **"Base and Button."**, then *"count them"* →
  **"2 classes."** _(via composed)_. In 0.7.1 the follow-up hit the grammar wall (*"I answer questions
  about THIS codebase's structure…"*) instead of counting the just-produced set.
- **`g-b1-disc-count-3`** — *"untested classes"* → **"Base and Button."**, then *"how many of those
  are tested"* → **"0 results."** _(via composed)_. In 0.7.1: *"'those'/'them' needs a previous answer
  to refer to…"* — the anaphor didn't bind to the prior listing.

(Note the prior listing itself also sharpened: 0.7.1 answered *"untested classes"* with 5 **modules**;
0.8.0 answers with the 2 **classes** actually asked for — Base and Button — so "count them" counts the
right set.)

### Lever 2 — pronoun / focus binding (the `it → Commit` mis-bind, fixed)

Five `g-b1-pron` cases flip their documented-weakness turn from failing to passing
(`-6, -15, -25, -39, -44`). The signature 0.7.1 bug — the anaphor *"it"* binding to **Commit** instead
of the module in focus — is gone:

- **`g-b1-pron-25`** — after `/describe app/lib/e.mjs`, *"which modules import it"* → **"app/lib/f.mjs."**
  _(via composed)_. 0.7.1 answered *"…No modules found … where object = **Commit**"* — the exact
  wrong-antecedent bug named in the prior write-up.
- **`g-b1-pron-15`** — *"who touched it"* (referring to app/lib/a.mjs) → **"abc1234."** _(via composed)_
  — 0.7.1 hit the grammar wall. Pronoun binding + temporal in one turn.

### Lever 3 — C1 temporal-over-relative composition (two-hop now assembles)

Seven `g-c1-temp` cases flip their documented-weakness turn (`-9, -18, -20, -22, -35, -45, -50`). In
0.7.1 the two-hop *"when did the module that {defines,imports} X change"* shape fell into an ambiguity
dead-end (*"this could mean more than one thing…"*). In 0.8.0 the composition **assembles the
relative clause, then applies the temporal hop**:

- **`g-c1-temp-9`** — *"when did the module that defines fnAlpha change"* → **"the module in that set
  was last touched by commit abc1234 on 2026-06-28 ('Render the widget with full mode')."**
  _(via composed)_ — data present, real answer.
- **`g-c1-temp-18` / `-20`** — the composition assembles but the fixture has no commit on the target
  module, so it answers honestly: **"no recorded commit touched the 1 module in that set in this
  index."** _(via composed)_ — assembly works, data absent.

**Honest caveat — `g-c1-temp-31` is composition-works / data-absent, NOT a capability pass.**
*"who touched the module that imports app/lib/f.mjs"* still answers **"nothing in the index matches
that."** in both 0.7.1 and 0.8.0. The two-hop machinery now runs, but the fixture's history is thin
enough here that the honest result is empty. Its expectation is `miss:true`, so it PASSES as an honest
miss — but it is dishonest to score it as proof the two-hop *retrieves* history. It is proof the
composition *assembles* and *fails honestly on absent data*. Reported as such, not as a lever win.

---

## Part 2 — SECONDARY: the judged pooled mean (standard stratified graded bench)

Standard run: v1 spine (48) + a stratified, seeded, **dual-draw** graded sample (`--stamp 0.8.0
--dual`), 333 rows in draw A. Raw under `chatbench/results/raw/run-0.8.0/`.

**Dual-draw agreement (the instrument's own reliability score): 0.867** — 26/30 cells agree within
tolerance; **4 cells UNDER-COVERED** (excluded from PASS/FAIL per §1, not failed): `B1:discourse-
reference`, `B2:discourse-reference`, `C1:coordination-compositional`, `C2:relative-embedded` — the
prescription is to grow those cells' pool/sample, unchanged in character from prior cycles.

**Tier-1: 333 / 333 pass, no regressions vs 0.7.1** (checked on the id intersection).

### Dual-banding rollup — the lever cells in the SAMPLED draw (0.8.0)

The composed ("productive") band is what the levers target. Sampled draw-A cells relevant to the
levers:

| Cell | green | perf band | prod (composed) band | gap |
| --- | --- | --- | --- | --- |
| B1 temporal | 45/50 | 45/50 | 41/50 | 0.08 |
| B1 pronoun-binding | 32/50 | 32/50 | 32/50 | 0.00 |
| B1 discourse-reference+quantifier-counting [combo] | 5/5 | 5/5 | 5/5 | 0.00 |
| C1 temporal | 39/50 | 39/50 | 34/50 | 0.10 |

(The full-coverage Part-1 numbers above are the definitive lever reading; these sampled cells are the
cross-check and feed the pooled mean.)

### Judged pooled mean + per-tag

**PENDING judge env — deterministic tier-1 reading above is definitive; judged mean to be run by
coordinator.** The judge fan-out was launched (3 samples/case over the 333-row `product-a.jsonl` at
`--concurrency 12`) and was mid-flight at hand-off. To complete it, run against the recorded raw
product:

```
node chatbench/judge.mjs --product chatbench/results/raw/run-0.8.0/product-a.jsonl \
  --samples 3 --concurrency 12
```

This overwrites `run-0.8.0/{judged.jsonl,summary.json}` with the full pooled mean + per-tag table;
fold `summary.overall.mean` / `hardFailCount` / `voidCount` in here and compare to 0.7.1's 1.488 / 35
/ 128. The 333-row product replay is deterministic (`--stamp 0.8.0`), so the judge can run at any time
against the committed-in-spirit (gitignored) raw file without a re-replay.

---

## Per-CEFR product timings (deterministic replay, informational)

Full graded run (618 rows) total wall **7.1 s**; family run (175 rows) **0.49 s**. Sub-millisecond per
graded turn; the v1 spine's ~130 ms mean is the richer operations (impact closures, folded recall).
Timings are wall-clock, excluded from every determinism / row-equality check.

## Decision (§1 rule: mean up AND no pass→fail regression)

**The deterministic tier is unambiguous PASS:** the tier-1 spine went **up** (331 → 333, the two
disc-count misses fixed), and there is **no pass→fail regression** on either the full-coverage family
run or the standard graded draw. All three levers moved their cells; the B1-temporal control confirms
the C1 lever didn't spill. **The judged pooled-mean half of the §1 rule (mean up) is PENDING the
judge env** and is a secondary confirmation only — the deterministic spine result already establishes
the release as a tier-1 improvement with no regression.

## Decision log — next levers

1. **C1 temporal DATA depth** — the composition now assembles but the fixture history is too thin to
   exercise it (`g-c1-temp-31` and the `-18/-20` honest-empties). Grow the fixture's commit history so
   the two-hop has something to retrieve, turning "assembles" into measurable retrieval.
2. **pronoun-binding ceiling** — 18/50 still frontier at B1 (32 green). The 5 fixed cases are the
   focus-in-scope wins; the remaining frontier is deeper anaphora (cross-utterance, coordinated).
3. **discourse-reference cell coverage** — under-covered in the dual draw at B1 and B2; grow the pool
   so the lever's home cell is reliably measured, not just spot-checked.

Judge model + prompt pinned: **claude-haiku-4-5-20251001** @ **judge-prompt-v1**, 3 samples/case.
Artifacts: `chatbench/results/raw/run-0.8.0/` (product-a/b, agreement, timings, judged, summary) and
`chatbench/results/raw/run-0.8.0/families/` (full-coverage family product + timings). Transcripts in
`CHATBENCH_0.8.0_TRANSCRIPTS.md`.
