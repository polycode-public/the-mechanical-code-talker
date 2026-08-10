# BENCHMARK_CEFR_ENGLISH_5.0.38 — lever round: the commit-counting window

**Headline: the affected cell judges at 1.818 / 2, up from 1.228 at the base commit. Hard fails 7
to 2. Tier-1 over the whole 1,075-case pool goes 1066 to 1073, the largest single move any lever
round in this arc has made, and nothing anywhere in the pool regressed.**

This is a lever cycle. It applies lever 1 from `reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`'s decision
log: the seven tier-1 failures sitting in one cell, `B2:quantifier-counting+temporal`. The
measurement follows the 5.0.36 and 5.0.37 pattern — a judged census of the affected cell plus the
free tier-1 replay over the whole pool as the regression guard.

## Run profile

- lever: the commit-counting window (`src/domain/ask.mjs`, plus one describe line in
  `src/domain/codegraph.mjs`)
- base commit: `4c76ac3e`; lever commit `4dfbe515`
- judged cell: `B2:quantifier-counting+temporal` (25) from
  `test-benchmarks/chatbench/graded-pool-max.jsonl` — the full census
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case,
  concurrency 12, delta-judged against a scratch copy of `verdict-cache.json` per arm so the
  committed cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.38/` (gitignored by design) —
  `fullpool-base/`, `fullpool-after/`, `judged-base/`, `judged-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 00:55 UTC to 01:45 UTC. The product replays are free and fast
  (all 1,075 in 4.5 s); the rest is the judge fan-out, 0 fresh cases on the base arm and 9 on the
  lever arm.
- Analysis and write-up: 2026-08-10 01:45 UTC to 02:20 UTC.
- Smoke before the run: `test:fast` 222/222; ask + codegraph + estate 457/457; corpus 1394/1394.

## What the failures actually showed

The 5.0.25 decision log called this cell "off by exactly the window boundary" and guessed at a
date comparison. The seven cases say something else. Here is the base arm against the fixture,
which holds one commit — `abc1234`, dated 2026-06-28, touching `app/lib/a.mjs` at module grain and
`Widget.render` at symbol grain.

| case | question | expected | answered |
|---|---|--:|--:|
| g-b2-count-temp-1 | how many commits touched the module that defines fnAlpha | 1 commit. | 2 commits. |
| g-b2-count-temp-2 | how many commits are recorded for app/lib/a.mjs | 1 commit. | 2 commits. |
| g-b2-count-temp-14 | how many commits touched app/lib/a.mjs | 1 commit. | 2 commits. |
| g-b2-count-temp-10 | how many commits are recorded for app/lib/b.mjs | 0 commits. | 1 commit. |
| g-b2-count-temp-19 | how many commits touched app/lib/b.mjs | 0 commits. | 1 commit. |
| g-b2-count-temp-18 | how many commits touched the module that defines register | 0 commits. | 1 commit. |
| g-b2-count-temp-25 | how many commits touched the module that defines Widget | 0 commits. | 1 commit. |

The sharpest statement of the bug is that the count and the list contradicted each other on the
same graph. "How many commits touched app/lib/a.mjs" answered 2; "which commits touched
app/lib/a.mjs" named one. "How many commits touched app/lib/b.mjs" answered 1; "which commits
touched app/lib/b.mjs" was an honest miss. The count could name a number the list could not
produce.

## The boundary rule

The window here is not a span of days. It is the history the index can actually hold: the commits
it records as `Commit` individuals, with a date and a touch set.

`commitTouchCount` read a `git:<sha>` ref in an entity's `derived_from` provenance as a touch. A ref
is not a touch. It names a commit and carries no date, and the fixture has both ways for that to go
wrong: `app/lib/a.mjs` names `git:def5678`, a commit the index holds no individual for at all, and
`app/lib/b.mjs` names `git:abc1234`, a commit the index does hold and whose recorded touch set does
not include b.mjs.

A ref now counts only where the graph has nothing better to say. Three cases:

- the graph holds the commit **and** records what it touched — that touch set is the index's own
  statement of the commit's reach, so it decides alone and the ref adds nothing;
- the graph holds the commit but records no touch edge for it anywhere (a truncated commit walk
  drops them) — the index is silent on its reach, the ref is the only attestation left, and it
  counts. This is the generosity the original code was reaching for, and it survives;
- the graph holds no commit for the sha — the index can neither name nor date it, so it sits
  outside the history this graph can count over and stays uncounted rather than being guessed into
  the total.

That is a pure function of the fact set. The attestable shas are read off the individuals and
sorted, so the count does not depend on arrival order.

Two more window defects sit in the same cell and are folded into the same round, because both are
confident wrong answers over a window the graph can bound exactly.

1. **A date window can now carry an entity kind.** "Which modules changed on 2026-06-28" used to
   fall through to the flat shapes, which read the date as an entity name and printed a five-way
   ambiguity list about the index's modules. "How many modules changed on 2026-06-28" answered a
   confident "0 modules." Both now bound the window first — the same `since`/`before`/`after`/`on`
   comparison the bare "what changed" shape already used — and then read what those commits touched
   at the asked grain. A pivot that bounds no window refuses in both shapes rather than reading as a
   grounded zero; a bounded window nothing reached at that grain names the kind and stays a miss.
2. **`/describe`'s attestation line counted the same refs** — and `turn:` refs alongside them, which
   are no commits at all — so it printed "touched by 2 commit(s)" three rows above an edge line
   saying `← touches (1) by abc1234`. It now says what it counts: "attestation: 2 provenance ref(s)".
   This one is in `src/domain/codegraph.mjs`, outside the round's own file, and is folded in because
   it is the same claim on a second surface.

Left alone: `g-b2-count-temp-5` ("which module changed most recently") is a ranking shape, not a
window one, and it already refuses with a hint that names what it can rank by. That is the
miss-over-guess contract working, not a defect to fix under this lever.

## Judged movement

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| B2 quantifier-counting+temporal | 25 | 1.228 | 1.818 | +0.590 | 7 | 2 |

The raw and the answer-identity-controlled views are the same number this round. Nine of the 25
answers changed; the other sixteen inherited the identical cached verdict on both arms, and no
unchanged answer scored differently across the two. The instrument note below says why that held
here and will not hold in general.

The nine cases that moved:

| case | base | lever |
|---|--:|--:|
| g-b2-count-temp-10 | 0.000 | 2.000 |
| g-b2-count-temp-14 | 0.000 | 2.000 |
| g-b2-count-temp-19 | 0.000 | 2.000 |
| g-b2-count-temp-23 | 0.000 | 2.000 |
| g-b2-count-temp-25 | 0.000 | 2.000 |
| g-b2-count-temp-2 | 0.250 | 2.000 |
| g-b2-count-temp-18 | 0.250 | 2.000 |
| g-b2-count-temp-8 | 0.500 | 2.000 |
| g-b2-count-temp-1 | 1.250 | 1.000 |

Eight went to a clean 2. The ninth went down, on an answer that is now right — see the instrument
note. The two hard fails left, `g-b2-count-temp-24` and `g-b2-count-temp-5`, are byte-identical in
both arms: a "how many symbols" count the vocabulary declines, and the ranking shape above.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1066 / 1075 | 1073 / 1075 |
| documented weaknesses now passing | 23 | 25 |

The two tier-1 failures left are `g-b2-coord-4` and `g-c1-presup-4`, the same two both arms carried.
Nothing that passed at the base fails on the lever, checked case-for-case against the base
`product.jsonl`.

Cell green-rates that moved, and this is the only one that moved anywhere in the pool:

| cell | base | lever |
|---|--:|--:|
| B2 quantifier-counting+temporal | 14 / 25 | 23 / 25 |

`g-b2-count-temp-8` and `g-b2-count-temp-23`, the two "on 2026-06-28" cases, join the
documented-weaknesses-now-passing list, so their expectations are enforced from here on.

## Predictions vs actuals

| prediction | actual |
|---|---|
| the seven tier-1 failures in the cell all clear | held: all seven, and the pool goes 1066 to 1073 |
| the cell's judged mean rises by more than any lever round so far, since seven of nine failures sit in it | held: +0.590, against +0.362 and +0.083 in the two prior rounds |
| no other cell moves, since the fix is confined to commit counting | held: exactly one cell's green rate changed |
| a window nothing can bound stays a refusal | held: an unrecognized pivot refuses in both the list and the count shape, pinned by a lane test and a corpus row |
| the fix reads as a date off-by-one, as the 5.0.25 log guessed | missed: there was no date comparison in the seven failures at all. The date-window defect is real but it lives in the two cases the pool had marked as documented weaknesses, not in the seven |

## Pins

- `test/tools/ask-combo.test.mjs` — 6 lane tests against the committed fixture and against a
  purpose-built three-commit graph: the recorded touch set deciding alone, the count and the list
  agreeing, the truncated-walk case where a ref still counts, the kind-headed window, the window's
  own edges (a commit dated on the boundary day is inside `since` and `on` and outside `after` and
  `before`), and an unbounded pivot staying a refusal in both shapes. The two 5.0.25-era pins
  asserting the old ref-counting behaviour are rewritten — the graded pool had contradicted them
  since it was authored.
- `test/corpus/games/compositional.jsonl` — 5 rows against `examples/mini-webapp`, keys
  `games.compositional.commit-window` and `commit-window-miss`. One pins the kind-headed window
  beside the bare shape, one the `since`/`after`/`before` boundary over a real eight-commit history,
  one the count and list agreeing, and two pin refusals: an unbindable pivot, and a real date the
  index holds no commit for.
- `test/corpus/grammar.jsonl` — the `grammar.count.commit-passive` row is rewritten to the window
  rule and gains a turn checking the passive and active phrasings answer the same.
- `test/adapters/codegraph.test.mjs` — the describe pin follows the relabelled attestation line.

## Instrument notes

**The judge context asserts what the pool denies.** `run.mjs`'s `FIXTURE_CONTEXT` tells the judge
that "saying app/lib/a.mjs was 'touched by 2 commit(s)' … is TRUTHFUL". The graded pool's own
`answerMatch` for the same module is `^1 commit\.$`. The two draws on `g-b2-count-temp-1` split
exactly along that line: one scored the now-correct "1 commit." a 2 against the case note, the other
scored it a 0 against the context paragraph. That is the whole of the case's 1.250-to-1.000 dip, and
it means the cell's true movement is understated by roughly one case's worth. Fixing the line
changes `FIXTURE_CONTEXT_VERSION` and voids every cached verdict in the pool, so it is not something
to do inside a round that is measuring against that cache.

**The verdict-cache partition** (carried from `reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`): a case
judged fresh on one arm and inherited on the other gets two independent draws, so a cell's raw mean
can move on judge noise alone. It did not bite this round, because the base arm judged nothing fresh
at all — all 25 inherited — and the lever arm judged only the 9 whose answers changed. Both arms
started from the same 635-entry snapshot. Judging both arms against one shared snapshot by
construction is still the fix, and it is still open.

Decision rule (§1): the cell mean is up by 0.590, the hard-fail count is down from 7 to 2, and no
previously-passing case regressed on the judged cell or across the full 1,075-case tier-1 replay.
**PASS.**

## Decision log — ranked next levers

1. **Conditional-question lane** (C1 conditional, 15/25 green with 10 frontier). "If a module
   imports app/lib/f.mjs, has it got tests" still answers a bare module name. A confident wrong
   answer is the worst rubric shape, and an honest miss alone would raise the cell. It is now the
   largest frontier block left outside the capability-waiting cells.
2. **C2 pronoun-binding** (13/25 green, 12 frontier). The second-largest frontier block, and no
   round in this arc has looked at it yet — worth a diagnosis pass before it is ranked properly.
3. **A `named <X>` qualifier** (`g-c2-rel-17`, `g-c2-rel-25`). "The module that is covered by X and
   named Y" needs a name-equality filter inside a boolean branch. Both cases still refuse to
   compile, and they are the last two frontier rows in C2 relative-embedded.
4. **A negation-scope filter for "do not define anything"** (B1/B2 negation). The complement is
   taken over the wrong set. Small, self-contained, two cells carry it.
5. **`g-c1-neg-rel-19`** (C1 negation+relative-embedded). "Modules importing the module that defines
   fnAlpha but not tested" answers b, c and e; the tested importer b.mjs should be excluded, so the
   "but not tested" branch filters the wrong set. It passes tier-1 on its answerMatch pins and fails
   the judge.
6. **`g-b2-coord-4` and `g-c1-presup-4`**, the only two tier-1 failures left in the pool. Two cases
   in two unrelated cells, so this is two small levers rather than one, and each moves the pool by a
   single case.
7. **Instrument: the judge context's commit-count paragraph**, above. Worth doing on its own, as a
   re-baseline rather than a lever round, since it re-judges the pool.
8. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Discriminating cases first.

### g-b2-count-temp-19 — judged 0.000 to 2.000

> how many commits touched app/lib/b.mjs

Before: 1 commit.

After: 0 commits.

b.mjs's provenance names `git:abc1234`, and abc1234 is a commit the index holds. Its recorded touch
set is `{app/lib/a.mjs, Widget.render}`. The graph has said what that commit reached, so the ref
cannot add b.mjs to it. The list form was already answering "No commits found whose module directly
touches app/lib/b.mjs" — the count now agrees with it.

### g-b2-count-temp-14 — judged 0.000 to 2.000

> how many commits touched app/lib/a.mjs

Before: 2 commits.

After: 1 commit.

The second commit was `def5678`, named in a.mjs's provenance and held nowhere in the index. It has
no date, no message and no touch set, so nothing about it can be shown to a user who asks a
follow-up. It sits outside the history this graph can count over.

### g-b2-count-temp-25 — judged 0.000 to 2.000

> how many commits touched the module that defines Widget

Before: 1 commit.

After: 0 commits.

The same rule under a relative clause. The inner clause resolves to app/lib/b.mjs, and the outer
count reads the same window the flat form reads.

### g-b2-count-temp-8 — judged 0.500 to 2.000

> which modules changed on 2026-06-28

Before: this could mean more than one thing: 1) as modules that touches "on 2026-06-28": no module
matching "on 2026-06-28" found in the index. … 2) as modules that touches "2026-06-28": …

After: app/lib/a.mjs.

The date was being handed to the term resolver as an entity name. The window it names is one the
graph can bound exactly — one commit, dated that day, touching one module.

### g-b2-count-temp-23 — judged 0.000 to 2.000

> how many modules changed on 2026-06-28

Before: 0 modules.

After: 1 module.

The count shape of the same question, and the worse of the two: a confident zero over a day the
index has a commit for.

### g-b2-count-temp-1 — judged 1.250 to 1.000

> how many commits touched the module that defines fnAlpha

Before: 2 commits.

After: 1 commit.

The one case that went down, on the answer the fixture asks for. One judge draw scored it 2 against
the case note ("1 commit touched app/lib/a.mjs … matches this ground truth exactly"), the other
scored it 0 against the judge context's own paragraph ("saying app/lib/a.mjs was 'touched by 2
commit(s)' … is TRUTHFUL"). The instrument is arguing with itself; see the instrument note.

### which modules changed since 2026-05-21 — mini-webapp probe, no pool case

> which modules changed since 2026-05-21 → src/core/store.mjs, src/core/model.mjs,
> test/tasks.test.mjs and test/store.test.mjs.
> which modules changed after 2026-05-21 → src/core/store.mjs and src/core/model.mjs.

The boundary day itself. `0a1b2c3d4e5f` is dated 2026-05-21 and touches the two test modules: inside
the `since` window, outside the `after` one. The committed fixture holds a single commit and cannot
show this, so the lane test builds a three-commit graph for it and the corpus row runs it against
the eight-commit example index.

### which modules changed on tuesday — mini-webapp probe, no pool case

> "tuesday" isn't a recognized date (yyyy-mm-dd) or a known commit — try "what changed since
> 2026-06-01" or "what changed before <commit>".

A window nothing can bound refuses, in the count shape as well as the list shape. Reading it as a
grounded "0 modules." would have been the cheap way to make the count shape work.
