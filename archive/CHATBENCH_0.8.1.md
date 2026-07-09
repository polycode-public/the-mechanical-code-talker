# CHATBENCH_0.8.1 — the quick-wins + 2-playtests release, selectively re-judged

**Headline (the load-bearing result is deterministic):** 0.8.1 changed answer
TEXT on several judged surfaces (quick-wins + two playtests) with **zero tier-1
regression** — the deterministic joint run holds **333 / 333** tier-1 (draw A) and
**285 / 285** (draw B) against the 0.7.1 compare base, and the instrument's own
reliability *rose*: dual-draw agreement **28 / 30 cells (0.933)**, up from 0.8.0's
26 / 30 (0.867). The touched judged tags were re-judged with the pinned judge and
compared to CHATBENCH_0.8.0.md; untouched tags carry their 0.8.0 scores.

> **Provenance note (read this):** the agent worktree was branched from `main`
> *before* the 0.8.1 chat merges had landed (it opened at version 0.8.0, HEAD's
> parent = the 0.8.0 "Phase 11 landed" commit). It was fast-forwarded to `main`
> (version **0.8.1**, containing the QW commit-refs `80fbb06`, the bare-coverage
> playtest `1af4343`, the authorship-synonym playtest `9f811df`, and the Stage-2
> ACE / goal-reasoner merges) so the product under test is the *real* 0.8.1. A
> first deterministic run against the stale 0.8.0 tree was discarded; every number
> below is from the 0.8.1 tree. `npm test` green at **916 / 916**.

Judge pinned: **claude-haiku-4-5-20251001** @ **judge-prompt-v1**, 3 samples/case,
`--concurrency 12`. Deterministic product replay: `--stamp 0.8.1`, no `Date.now`;
full graded run 618 rows, wall **6.0 s**.

---

## Part 1 — PRIMARY: the deterministic joint result (judge-free, load-bearing)

Command (raw under `chatbench/results/raw/run-0.8.1/`):

```
node chatbench/run.mjs --stamp 0.8.1 --dual \
  --compare chatbench/results/raw/run-0.7.1/product-a.jsonl \
  --out chatbench/results/raw/run-0.8.1
```

- **Tier-1: 333 / 333 (draw A), 285 / 285 (draw B).** No tier-1 regression on the
  id intersection vs `run-0.7.1/product-a.jsonl` ("no tier-1 regressions vs compare
  base" printed).
- **Dual-draw agreement 28 / 30 (0.933)** — up from 0.8.0's 0.867. The 2 remaining
  UNDER-COVERED cells (excluded from PASS/FAIL per SKILL §1, not failed):
  **B1 pronoun-binding+negation** and **B2 discourse-reference** — grow their
  pool/sample. (0.8.0's under-covered set was different: B1/B2 discourse-reference,
  C1 coordination-compositional, C2 relative-embedded.)

### The QW/PT surfaces now answer — cited flips (0.7.1 → 0.8.1, verbatim)

The compare base is 0.7.1, so the diff is cumulative; the **0.8.1-specific** flips
(vs 0.8.0) are the quick-wins and the two playtests:

| Surface | Case(s) in draw | 0.7.1 | 0.8.1 | Kind |
| --- | --- | --- | --- | --- |
| `who touched X` names the author | `gq-who-touched-a`, `mt-ask-then-touched`, `mr-graph-intact`, `g-b1-pron-15/19/46`, `g-b1-temp-14/41`, `g-c1-temp-13/17` | `abc1234.` | **`abc1234 (Ada Lovelace).`** | **QW** |
| authorship synonyms (`who wrote/authored X`, `who is the author of C`) | `g-c1-temp-24/25` (+ live-probe `who wrote/authored X`) | grammar wall | **routed → answer** | **PT** |
| honest-empty coverage render | live-probe `what tests cover app/lib/a.mjs` | `No modules found whose module directly tests cover …` | **`No tests cover app/lib/a.mjs.`** | **QW** |
| singular `what is a test` | live-probe | orientation/wall | **corpus definition + example test edges** | **QW** |
| bare coverage survey (`what is untested`, `what needs tests`) | live-probe | grammar wall / "no module matching 'not'" | **module survey answered** | **PT** |
| focus-drift held (v1) | `mt-focus-drift` | `No modules found … where object = Commit` | **`app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.`** (tier-1 FAIL→PASS) | **QW/routing** |

**Honest render artifact (flagged, not a regression):** the clean "No tests cover
X" template is keyed to the canonical verb "cover"; on the non-canonical synonym
"what tests **touch** X" (`g-a2-svo-11/-12`) it leaks the stray verb —
`No tests cover touch app/lib/f.mjs.` Both tier-1 pass (honest miss); 0.7.1 was
equally awkward. Full transcripts (incl. the carried 0.8.0 pronoun/two-hop/
discourse-count flips) in `CHATBENCH_0.8.1_TRANSCRIPTS.md`.

**Reproducibility scrub:** the ACE fact-recall citation (volatile session id +
timestamp in 0.7.1) is scrubbed to `ace:chat:<session>@<ts>` in 0.8.1
(`g-b2-assert-14`, `g-c1-assert-12`) so replayed rows are byte-stable.

---

## Part 2 — SELECTIVE re-judge: touched tags vs 0.8.0

0.8.1 changed answer TEXT on the **quick-win** surfaces (`who touched X` →
"abc1234 (Ada Lovelace)", honest-empty "No tests cover X", singular "what is a
test") and the **playtest** surfaces (bare coverage survey, authorship routing).
Those land in the tags **graph-query, ambiguity, multi-turn-focus, memory-recall,
honesty-miss** and the **A1 graded** cells — so the 0.8.0 judged scores for these
tags are **stale** and were **re-judged**. All other v1 tags are **untouched** and
carry their 0.8.0 scores.

Re-judge: 46 cases × 3 samples = **138 samples, 0 voids**, judge
`claude-haiku-4-5-20251001` @ `judge-prompt-v1`. Raw under
`chatbench/results/raw/run-0.8.1/selective/`.

### Re-judged tags (compared to CHATBENCH_0.8.0.md)

| Tag | Cases | 0.8.0 | 0.8.1 (re-judged) | Δ | Read |
| --- | ---: | ---: | ---: | ---: | --- |
| **graph-query** | 15 | 1.689 | **1.741** | **+0.052** | ↑ — the QW author-name render (`gq-who-touched-a`) scored cleaner |
| **honesty-miss** | 5 | 1.467 | **1.600** | **+0.133** | ↑ — honest-empty renders read better; no new confident-wrong |
| **multi-turn-focus** | 5 | 1.900 | **1.900** | 0.000 | flat-high — `mt-focus-drift` holds, QW author-name absorbed |
| **memory-recall** | 3 | 1.833 | **1.833** | 0.000 | flat — recall surfaces unchanged in substance |
| **ambiguity** | 4 | 1.521 | 1.250 | −0.271 | **judge noise, NOT product** — see below |
| A1 graded (in draw) | 15 | — (sampled) | 1.852 | — | not case-comparable (fresh seeded draw ≠ 0.8.0's); reported for record |

**The `ambiguity` −0.271 is judge sampling variance, not a regression.** Its 4
cases' answer text is **byte-identical to 0.8.0** (no am-* case is on a QW/PT
surface; tier-1 shows no am-* regression). The dip is driven by `am-bare-name`
(0.667) — a *documented baselineFail* weakness (bare "Widget" → orientation) whose
answer is unchanged since before 0.8.0 — re-sampled by the noisy judge over n=4.
`ambiguity` is included in the re-judge only because the task scoped it as
possibly-touched; the deterministic tier confirms it did not move.

**The 1 hard-fail is a long-standing documented weakness, not a 0.8.1 regression.**
`gq-functions-call-fnalpha` ("which functions call fnAlpha" — the recorded
`callsSymbol` edge isn't surfaced) hard-fails (dims all 0). Its answer is
**byte-identical to 0.7.1/0.8.0** (a `baselineFail` case since cycle 1), so this is
the same known miss the pooled 0.8.0 hard-fail count already carried, resurfaced by
scoring it in isolation — not a new failure.

### Carried tags (surface untouched — 0.8.0 scores stand)

| Tag | Cases | 0.8.0 = 0.8.1 | Status |
| --- | ---: | ---: | --- |
| bootstrap-empty | 2 | 2.000 | unchanged — surface untouched, 0.8.0 score carried |
| typo-fuzzy | 4 | 1.917 | unchanged — surface untouched, 0.8.0 score carried |
| noise | 5 | 1.900 | unchanged — surface untouched, 0.8.0 score carried |
| conversational | 6 | 1.806 | unchanged — surface untouched, 0.8.0 score carried |

(The pooled `graded` sample re-draws its 10% every run on a fresh seed, so its
pooled scalar is not case-comparable across versions — see SKILL §1 / GRADED.md;
the deterministic cell-level tier is the comparable graded signal.)

---

## BEST EXAMPLES (the demo reel — verbatim 0.8.1 rows)

1. **QW author-name on a pronoun chain** — `g-b1-pron-15`:
   `which modules import app/lib/a.mjs` → *"app/lib/b.mjs and app/lib/c.mjs and
   app/lib/e.mjs."* → `what does it import` → honest empty → `who touched it` →
   **"abc1234 (Ada Lovelace)."** — anaphora + QW author render in one chain.
2. **Focus-drift held** — `mt-focus-drift`: `/describe app/lib/a.mjs` →
   `what calls it` → *"scripts/g.mjs."* → `which modules import it` →
   **"app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs."** (the `it → Commit`
   mis-bind is gone; tier-1 FAIL→PASS).
3. **Discourse-count** — `g-b1-disc-count-22`: `untested classes` →
   *"Base and Button."* → `count them` → **"2 classes."**
4. **C1 two-hop temporal retrieves** — `g-c1-temp-9`:
   `when did the module that defines fnAlpha change` → **"the module in that set
   was last touched by commit abc1234 on 2026-06-28 ('Render the widget with full
   mode')."**
5. **Authorship synonym off the wall** — `g-c1-temp-24`:
   `who is the author of abc1234` → **"commit abc1234 touched module app/lib/a.mjs;
   method Widget.render()."** (routes off the grammar wall; honest caveat — it
   returns the touch-set, not the author string, in this phrasing).

---

## Decision (SKILL §1 rule: mean up AND no pass→fail regression)

**Deterministic tier — PASS.** Tier-1 held 333/333 (A) and 285/285 (B) with no
pass→fail regression vs 0.7.1; the QW/PT surfaces that changed text all flip
toward real answers or cleaner honest misses; dual-draw agreement rose
0.867 → 0.933. **Selective judged tier — confirms on the comparable axis:** the two
re-judged tags whose surfaces the QW actually touched with substance moved UP
(`graph-query` +0.052, `honesty-miss` +0.133); `multi-turn-focus` and
`memory-recall` held; `ambiguity` −0.271 is judge variance on unchanged text
(deterministic tier shows no am-* movement), and the lone hard-fail is a
byte-unchanged documented weakness carried from prior cycles. **Net: deterministic
PASS, judged re-judge confirms on the surfaces that moved.**

## Decision log — next levers

1. **"No tests cover X" synonym cleanup** — the honest-empty render leaks the stray
   verb on `what tests **touch** X` (`No tests cover touch …`). Normalize the
   coverage-miss render to the canonical verb across the tests/coverage synonyms.
2. **authorship phrasing depth** — `who is the author of <commit>` routes off the
   wall but returns the touch-set, not the author string. Route commit-authorship
   phrasings to name the author (the fixture holds `commit-abc → Ada Lovelace`).
3. **grow the 2 under-covered cells** — B1 pronoun-binding+negation, B2
   discourse-reference disagreed in the dual draw; grow pool/sample so they're
   measured, not spot-checked.
4. **`gq-functions-call-fnalpha`** — the recorded symbol-level `callsSymbol` edge
   (Widget.render → fnAlpha) is still not surfaced for "which functions call
   fnAlpha"; the standing hard-fail. Surface the symbol-grain caller.

Judge model + prompt pinned: **claude-haiku-4-5-20251001** @ **judge-prompt-v1**,
3 samples/case. Artifacts: `chatbench/results/raw/run-0.8.1/` (product-a/b,
agreement, timings) and `chatbench/results/raw/run-0.8.1/selective/`
(judged.jsonl, summary.json — the touched-tag re-judge). Transcripts in
`CHATBENCH_0.8.1_TRANSCRIPTS.md`.
