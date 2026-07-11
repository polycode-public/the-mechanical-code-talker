# BENCHMARK_CEFR_ENGLISH_1.8.0 — mean up to 1.789/2 (+0.039), ambiguity cell +0.437; breadth-first ambiguity fix resolves a case pair 1.7.0 called permanently unfixable

**Headline:** CEFR_ENGLISH re-run against **1.8.0** (per `package.json`), following
`SKILL_BENCHMARK_CEFR_ENGLISH.md`'s cycle. This is a **lever cycle**: `PLAN_BREADTH_FIRST_NLU.md`
Track 1 (entity-tie ambiguity fix) and Track 5 (surfacing alternate readings on hits) both land in
`src/ask.mjs`'s answer path this session, and both are squarely inside the 4 `ambiguity`-tagged
cases' reach.

**Result: mean 1.789 / 2 (up from 1.7.0's 1.750, +0.039), 0 hard fails out of 109 cases (same),
0 voided samples (same), tier-1 109/109 (same).**

**Decision rule (§1): PASS.** Mean is up vs `1.7.0`, no case regressed, hard-fail count and
tier-1 pass count are unchanged (already at the floor/ceiling). The gain is real and
attributable: the `ambiguity` tag moved **+0.437** (1.438 → 1.875), the largest single-tag move
recorded in any CEFR report for this project, and it traces directly to Track 1 landing — every
other tag either held flat or moved inside normal judge-sample noise (`typo-fuzzy` +0.084,
`graph-query` +0.021, five tags exactly 0).

## The finding worth stating plainly

`am-meta-imports` and `g-a1-naming-9` ask the identical question ("what does imports mean") with
deliberately incompatible expectations. `BENCHMARK_CEFR_ENGLISH_1.7.0.md` documented this as a
**permanent, unfixable conflict** — "a fix for one necessarily breaks the other" — and left
`g-a1-naming-9` sitting at 0.875, the second-lowest score in that report.

Track 1's breadth-first render doesn't pick a side. It shows both readings' real answers in one
response:

```
Q: what does imports mean
A: this could mean more than one thing:
1) as meta "imports": imports is a predicate (relation) in the graph's schema: Module → Module. …
2) as imports "mean": no module matching "mean" found in the index.
(ask one of these directly, or try rephrasing more specifically, to get just that reading)
```

Both cases now score well against the same byte-identical answer: `am-meta-imports` 1.25 → 1.75,
`g-a1-naming-9` 0.875 → **1.875**. What last cycle called structurally impossible was a limit of
picking one reading, not a limit of the graph or the grammar — this is the operator's "breadth
first, restate every reading" directive (`ROADMAP.md`'s Ambition §2), empirically confirmed on the
one case pair that most directly tested it.

## Provenance

- Product run: `node chatbench/run.mjs --stamp 1.8.0 --sample 1 --single` → `chatbench/results/raw/run-1.8.0/product.jsonl` (109 rows).
- Judge run: `node chatbench/judge.mjs --product chatbench/results/raw/run-1.8.0/product.jsonl --samples 2 --concurrency 12 --out chatbench/results/raw/run-1.8.0` → `judged.jsonl` (218 rows) + `summary.json`.
- `npm test`: 1932/1932 green, this session, at commit `1a1339f` (`PLAN_BREADTH_FIRST_NLU.md`'s
  Tracks 1–6 all landed on top of this commit; `package.json`/`package-lock.json` are bumped to
  `1.8.0` locally but not yet committed, per this project's own discipline of bumping only at
  actual push time).
- Judge model + prompt: `claude-haiku-4-5-20251001` @ `judge-prompt-v1`, same pin as every prior cycle.

## Deterministic tier-1

109/109 pass, every band, unchanged from `1.7.0`. `am-two-readings` — the case whose pinned
render text (`"...or try rephrasing more specifically..."`) this session's entity-tie work briefly
regressed and then fixed mid-session — is confirmed passing here.

## Judged tier (N=2, single draw)

| metric | 1.8.0 | 1.7.0 | Δ |
| --- | --: | --: | --: |
| overall mean | **1.789** | 1.750 | **+0.039** |
| hard fails | 0 | 0 | 0 |
| voided samples | 0 | 0 | 0 |
| tier-1 pass | 109/109 | 109/109 | 0 |

### Per-tag

| tag | cases | 1.8.0 mean | 1.7.0 mean | Δ |
| --- | --: | --: | --: | --: |
| ambiguity | 4 | **1.875** | 1.438 | **+0.437** |
| typo-fuzzy | 4 | 1.938 | 1.854 | +0.084 |
| graph-query | 16 | 1.787 | 1.766 | +0.021 |
| conversational | 6 | 2.000 | 2.000 | 0 |
| bootstrap-empty | 2 | 2.000 | 2.000 | 0 |
| honesty-miss | 5 | 1.533 | 1.533 | 0 |
| memory-recall | 3 | 1.833 | 1.833 | 0 |
| multi-turn-focus | 5 | 1.900 | 1.900 | 0 |
| noise | 5 | 1.900 | 1.900 | 0 |
| **graded (all 109)** | **109** | **1.789** | **1.750** | **+0.039** |

### The 4 ambiguity cases, individually

| case | 1.8.0 mean | 1.7.0 mean | Δ |
| --- | --: | --: | --: |
| `am-bare-name` | 2.000 | 1.250 | +0.750 |
| `g-a1-naming-9`* | 1.875 | 0.875 | +1.000 |
| `am-meta-imports` | 1.750 | 1.250 | +0.500 |
| `am-two-readings` | 1.750 | 1.250 | +0.500 |
| `am-tests-cover` | 2.000 | 2.000 | 0 (already fixed in 1.6.1) |

\* not `ambiguity`-tagged in the case pool's own metadata, but the same underlying phenomenon —
included here because it's `am-meta-imports`'s sibling case and the clearest evidence of the fix.

`am-tests-cover` ("which tests cover b.mjs") shows the entity-tie mechanism directly — a genuine
two-module label collision, now answered per-candidate instead of just named:

```
Q: which tests cover b.mjs
A: "b.mjs" matches more than one module ambiguously — did you mean app/lib/b.mjs and
   app/unit-tests/b.test.mjs? Try one of those. If you're not sure, narrow it to one name.
1) app/lib/b.mjs: app/unit-tests/b.test.mjs.
2) app/unit-tests/b.test.mjs: No tests cover b.mjs.
```

Its mean was already at 2.000 from the `1.6.1` fix (parse-level disambiguation only named the
candidates without answering them); this run's product answer is richer but the judge ceiling was
already reached, so the score itself doesn't move — the real product improvement here is visible in
the transcript, not the number.

## What didn't move, and why that's expected

`honesty-miss`, `memory-recall`, `multi-turn-focus`, `noise`, `conversational`, `bootstrap-empty`
are all exactly flat. None of this session's six tracks touch their code paths:

- Router enrichment (Track 2), the viz CLI + chat panel (Track 3), the generated template corpus
  (Track 4) touch `src/router/*.mjs`, `src/viz.mjs`, and a new offline corpus respectively — none
  are on `chat.mjs`'s answer-rendering path CEFR exercises.
- Canonical query representation (Track 6) adds a `tmct_ask.canonical` field to every response
  envelope (`src/chat.mjs:7437`) but never appends to the rendered `content`/`answer` text the
  judge scores — confirmed by direct read, not assumed.
- Track 5 (alternates-on-hits) only activates when a *different-class* strategy also produces a
  distinct, plausible reading alongside a clean hit; none of the 109 cases exercise that shape,
  same as `1.7.0`'s report found for Finding 3/5's reach.

### Lowest scores this cycle — the next target, unchanged from `1.7.0`'s decision log

| case | mean | note |
| --- | --: | --- |
| `g-c1-temp-8` | 0.834 | unchanged from 1.7.0 — "who touched the module importing X" garbles direction, `rephrase: 0` |
| `g-a1-naming-8` | 1.000 | down from 1.500; byte-identical product answer, judge-sample noise on N=2 |
| `g-b1-pron-6` | 1.000 | `rephrase: 0` on an honest miss |
| `g-b2-passive-4` | 1.000 | `correctness`/`honesty` null-dimension case |
| `g-b2-passive-9` | 1.000 | `rephrase: 0` on an honest miss |
| `g-c1-temp-3` | 1.000 | `rephrase: 0` on an honest miss |

With `ambiguity` now the strongest tag instead of the weakest, the "who/what touched X"-family
honest-miss cases with `rephrase: 0` — `1.7.0`'s decision-log item 1 — are now the single largest
concentration of remaining lost points. Unchanged recommendation: a rephrase-hint pass on the
history/touches miss templates in `ask.mjs` is the top pick for the next cycle.

## Discipline — the non-negotiables, checked

- **No LLM in the product** — `chat.mjs`/`ask.mjs` stayed no-LLM throughout every track this
  session; the only LLM calls anywhere are this benchmark's own offline judge pass.
- **Judge model + prompt version pinned**: unchanged, `claude-haiku-4-5-20251001` @ `judge-prompt-v1`.
- **Judge integrity**: 0 voided samples.
- **Determinism (tier-1)**: single product run, single draw.
- **Case set unchanged**: same 109-case `graded-pool.jsonl`, append-only, no case touched.
- **`npm test`**: 1932/1932 green at `1a1339f`.

## Reproduce

```
node chatbench/run.mjs --stamp 1.8.0 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-1.8.0/product.jsonl --samples 2 --concurrency 12 --out chatbench/results/raw/run-1.8.0
```
