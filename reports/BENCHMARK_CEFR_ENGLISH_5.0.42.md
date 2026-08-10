# BENCHMARK_CEFR_ENGLISH_5.0.42 — tail round: the last two tier-1 failures, and a hint that pointed at the wrong part of the index

**Headline: the pool has no tier-1 failures left. `g-b2-coord-4` and `g-c1-presup-4` turned out to
be one defect, not two, and both clear on a single change; the deterministic replay over all 1,075
cases goes 1073/1075 to 1075/1075. `g-b1-neg-11`'s recovery line now names the branch its own
question asked about, and its hard fail clears. Three answers change across the whole pool and
nothing regresses.**

This is a lever cycle over the tail of the CEFR list. It takes the three named cases the 5.0.41
decision log left as product lines rather than judge noise. The measurement follows the 5.0.36 to
5.0.41 pattern: the free tier-1 replay over the whole pool on both arms as the primary instrument,
plus a judged census of the one cell where the fix changes prose a tier-1 pin cannot see.

## Run profile

- levers: a standalone-marker rule for enumerated choice labels (`src/domain/choice-question.mjs`),
  and a qualifier-branch note for an emptied whole-kind set (`src/domain/ask.mjs`)
- base commit: `2375fa5b`; lever commits `2b521c5b` and `5b194957`
- judged cell: `B1:negation` (25) from `test-benchmarks/chatbench/graded-pool-max.jsonl` — the full
  census. It is the only cell whose prose changed without a tier-1 pin moving.
- judge: `claude-haiku-4-5-20251001`, prompt `judge-prompt-v2`, N=2 samples per case, concurrency
  12, delta-judged against a scratch copy of `verdict-cache.json` per arm, both copies taken from
  the same committed snapshot, so the committed cache is untouched
- regression guard: the deterministic tier-1 replay over all 1,075 cases of
  `graded-pool-max.jsonl`, run on the base commit and on the lever
- raw output: `test-benchmarks/chatbench/results/raw/run-5.0.42/` (gitignored by design) —
  `fullpool-base/`, `fullpool-after/`, `cells-base/`, `cells-after/`, `judged-base/`,
  `judged-after/`
- voided samples: 0 in both arms

## Timing

- Benchmarking session: 2026-08-10 04:38 UTC to 05:03 UTC. The product replays are free and fast
  (all 1,075 in 4.2 s per arm); the rest is the judge fan-out, 16 fresh cases on the base arm and
  17 on the lever arm.
- Analysis and write-up: 2026-08-10 05:03 UTC to 05:30 UTC.
- Smoke before the run: `test:fast` 222/222; choice-question 70/70; ask tier 237/237; domain +
  adapters 4,174/4,174; estate 101/101 (7 skipped); compositional corpus lane 62/62; grammar corpus
  lane 367/367; `printf 'hi\n/exit\n' | node bin/tmct.mjs` greets and exits 0 in a graph-less temp
  dir.

## What the failures actually showed

| case | question | expected | answered at the base |
|---|---|---|---|
| g-b2-coord-4 | modules importing a.mjs or b.mjs | four modules | I can't tell what these options are alternatives about |
| g-c1-presup-4 | why does a.mjs still import b.mjs | correct the false premise | I can't tell what these options are alternatives about |
| g-b1-neg-11 | which functions are not exported | an empty set | the empty set, under a nudge about commits |

**Two cells, one defect.** The 5.0.41 decision log ranked `g-b2-coord-4` and `g-c1-presup-4` as two
small levers because they sit in unrelated cells. Replaying them first showed the same sentence
coming back from both, and the same reason behind it. The closed multiple-choice reader recognizes
an enumerated option list by finding label markers — a letter followed by `.`, `)` or `:` — in
strict A, B, C order. It matched the `a.` inside `app/lib/a.mjs` and the `b.` inside `app/lib/b.mjs`.
So "which modules import app/lib/a.mjs or app/lib/b.mjs" split into a stem of "which modules import
app/lib/" and two option fragments, and the choice lane answered about alternatives instead of
letting the question through to the compositional reader. "why does app/lib/a.mjs still import
app/lib/b.mjs" lost its presupposition check the same way, on the same two paths.

The existing presupposition corpus row uses `app/lib/f.mjs` and `app/lib/a.mjs` — an f, a pair,
which is not an A, B run — so the lane stayed green in the corpus while the pool's a/b case failed.

**A correct answer under an unrelated recovery.** `g-b1-neg-11` asks which functions are not
exported. fnAlpha is the only function in the fixture and `d/handler.mjs` re-exports it, so the
empty set is the ground truth and the verdict was already right. The nudge beside it read `Try "who
touched <a module that actually has commits>"`. The question never mentioned a commit. That line is
the touches-family rephrase hint, reached as the last fallback of the composite set miss, and it had
become the default for questions with nothing to do with change history.

## The two rules

**A label marker stands alone.** Whitespace or a text edge on both sides of it. A letter and a dot
inside a dotted path have neither, so `a.mjs` is part of a path and never the opening of an option
list. Every enumerated form still parses: bare `A)`, parenthesized `(A)`, dotted `A.`, colon `A:`,
and a marker that closes at the very end of the text.

**A qualifier that empties a whole kind offers its own other side.** Where the set came from an
unrestricted kind, the qualifier is the only thing that can have emptied it, so the branch worth
offering is that same qualifier at the opposite polarity — "which functions are exported" for a
question that asked which are not. Both polarities compile, so the nudge always names a question the
parser accepts and answers; the positive shape parses to a qualifier node and the negative to a
boolean, and both are read.

Scoped to an unrestricted set on purpose. Once a clause narrows the set first, the clause may be
what emptied it, and naming the qualifier's branch would point past the real gap. Those keep the
general nudge; their receipt is the composite-branch work that is still open.

Both rules read only the parse and the fact set, so they give the same answer whichever order the
individuals arrive in.

## Tier-1 over the whole pool

| | base | lever |
|---|--:|--:|
| tier-1 pass | 1073 / 1075 | **1075 / 1075** |
| documented weaknesses now passing | 40 | 40 |

`g-b2-coord-4` and `g-c1-presup-4` were the pool's last two tier-1 failures, in two different
cells. Both clear. Diffing the two arms' `product.jsonl` case for case, exactly three of the 1,075
answers changed — those two plus `g-b1-neg-11` — and nothing that passed at the base fails on the
lever.

Cell green-rates that moved, and these are the only ones that moved anywhere in the pool:

| cell | base | lever |
|---|--:|--:|
| B2 coordination-compositional | 49 / 50 | 50 / 50 |
| C1 presupposition | 24 / 25 | 25 / 25 |

## Judged movement — B1 negation

`g-b1-neg-11` passes tier-1 on both arms: its pins are `miss` plus two `answerNotMatch` strings, and
the recovery line satisfies them either way. Only the judge can see the change, which is why this
cell gets a census.

| cell | n | base mean | lever mean | delta | base hard fails | lever hard fails |
|---|--:|--:|--:|--:|--:|--:|
| B1 negation | 25 | 1.867 | 1.920 | +0.053 | 2 | 0 |

**Answer-identity-controlled view.** 24 of the 25 answers are byte-identical across the arms, and
they score 1.938 against 1.979 — a delta of +0.041 that is the instrument, not the lever. The one
changed answer goes 0.167 to 0.500.

The same control has to be applied to the hard-fail count by hand, and it matters more here than
the mean does. Two hard fails cleared, but only one of them on a changed answer:

| case | base | lever | answer |
|---|--:|--:|---|
| g-b1-neg-11 | 0.167 | 0.500 | changed |
| g-b1-neg-12 | 0.500 | 1.500 | byte-identical |

`g-b1-neg-12` moved a full 1.0 and crossed the hard-fail line on text that never changed. That is
the verdict-cache partition, and it is the largest single swing this instrument note has produced
across the rounds that have recorded it. **This round's honest claim is one hard fail cleared, not
two.**

Per dimension on `g-b1-neg-11`:

| dimension | base | lever |
|---|--:|--:|
| groundedness | 0 | 0.5 |
| honesty | 0 | 0 |
| rephrase-hint helpfulness | 0.5 | 1.0 |

Rephrase-hint helpfulness doubled, which is the dimension the fix aims at, and the judge's own
second sample says why: "the suggestion to ask 'which functions are exported' is a concrete
alternative". Honesty did not move at all, and the reason is in the next section.

## The rest of g-b1-neg-11 is a different sentence

Both judge samples on both arms object to the same words, and they are not the recovery line:

> tmct claims 'nothing in the index matches that (functions)' but the graph contains fnAlpha.

The verdict is an empty set, which is correct. The sentence that reports it says "nothing in the
index matches that (functions)", and the judge reads that as a claim that the index holds no
functions — which is false. What is true is narrower: the index holds functions, and none of them
is un-exported. A miss line that cannot tell "this kind is empty" from "this kind is non-empty and
nothing satisfied the filter" reads as a stronger claim than the engine can support, and the
honesty dimension scores it accordingly.

That sentence is the shared lead of the composite set miss. It heads **121 of the 1,075 answers,
across 15 cells** — B2 relative-embedded (23), C2 garden-path (19), C1 relative-embedded (16) and
twelve more. Rewriting it moves the prose on all of them at once and needs its own judged round
against those cells, so it is not folded in here; this round was scoped to the recovery line's
applicability. It is recorded as an open item, and it is the strongest-evidenced lever the pool now
carries: the judge states the objection in its own words, unprompted, on every sample.

## Predictions vs actuals

| prediction | actual |
|---|---|
| `g-b2-coord-4` and `g-c1-presup-4` are two small levers in two unrelated cells | missed, and in the useful direction: one defect in a shared reader, one change, both clear |
| `g-b1-neg-11`'s recovery line stops naming commits | held: it names the exported-functions branch, and rephrase-hint goes 0.5 to 1.0 |
| `g-b1-neg-11` clears its hard fail | held, on a changed answer — 0.167 to 0.500 |
| the qualifier-branch note is narrow enough not to disturb other cells | held: one pool answer touched, no cell mean moved |
| the marker fix leaves every enumerated choice form parsing | held, pinned by seven lane tests including the parenthesized, dotted and colon forms |
| the cell mean rises by about the size of one cleared hard fail | missed: the raw +0.053 is mostly instrument. The controlled split is +0.333 on the changed answer against +0.041 on the 24 unchanged ones |

## Pins

- `test/domain/choice-question.test.mjs` — 7 lane tests: the two failing pool sentences declining
  outright, a file extension after a single letter, a letter run inside a dotted class name, and
  the bare, parenthesized, dotted and colon marker forms still parsing.
- `test/tools/ask-combo.test.mjs` — 5 lane tests against the committed fixture: the emptied
  whole-kind qualifier offering its own branch with no commit nudge, that branch round-tripping to
  a real answer, the positive polarity offering the negative one, a clause-narrowed set keeping the
  general nudge, and the two-path disjunction unioning both import sets.
- `test/corpus/games/compositional.jsonl` — 2 rows against `examples/mini-webapp`, keys
  `games.compositional.qualifier` and `games.compositional.boolean-or`. One pins the branch note
  and the answer it points at, one pins the dotted-path disjunction.
- `test/corpus/grammar.jsonl` — 1 row against `test/fixtures/entities-repo`, key
  `grammar.presupposition.premise-check`, pinning the premise check over an a/b path pair, the
  exact order the existing row's f/a pair never exercised.

## Instrument notes

Both carried from earlier rounds, both still open.

**The verdict-cache partition** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.37.md`). The committed cache
covered 9 of this cell's 25 cases on the base arm and 8 on the lever arm, so about 16 cases were
judged fresh on both arms independently, twice over. One of them, `g-b1-neg-12`, landed 1.0 apart on
text that never changed and took a hard-fail flag across the line with it. Every round since 5.0.39
has had to hand-control for this; this is the largest swing any of them has recorded, and on a cell
this small it decides the raw hard-fail count outright. Judging both arms against one shared
snapshot by construction is still the fix.

**The judge context asserts what the pool denies** (`reports/BENCHMARK_CEFR_ENGLISH_5.0.38.md`).
`run.mjs`'s `FIXTURE_CONTEXT` calls "touched by 2 commit(s)" truthful for `app/lib/a.mjs` while the
pool's own expectation is `^1 commit\.$`. Untouched here: rewriting it moves
`FIXTURE_CONTEXT_VERSION` and re-judges the pool, which is a re-baseline run rather than a lever
round.

## A file this round touched outside its brief

The two tier-1 failures were dispatched as `src/domain/ask.mjs` and `src/domain/interpret/` work.
Their root is in neither — it is `src/domain/choice-question.mjs`'s label-marker regex. The fix
landed there rather than being worked around downstream.

Decision rule (§1): the cell mean is up, the hard-fail count is down (one on a changed answer, one
on the instrument), tier-1 over the whole pool goes 1073/1075 to 1075/1075, and no
previously-passing case regressed on the judged cell or across the full replay. **PASS.**

## Decision log — ranked next levers

1. **The composite miss lead, "nothing in the index matches that".** New, and the best-evidenced
   item on this board: the judge names it in its own words on every sample of `g-b1-neg-11`, and it
   heads 121 answers across 15 cells. Separating "this kind is empty" from "this kind is non-empty
   and nothing satisfied the filter" is one sentence's worth of change with a pool-wide reach, so it
   is a judged round over its top cells, not a spot fix.
2. **C2 pronoun-binding** (13/25 green, 12 frontier). The largest frontier block left outside the
   cells waiting on a capability, and no round in this arc has looked at it. It needs a diagnosis
   pass before it can be ranked on evidence rather than on size.
3. **B2 assert-recall** (16/25 green, 9 frontier). Its performance-vs-production band gap is 0.64,
   the widest in the pool, which says the capability is there and something in the production path
   is not reaching it.
4. **A composition receipt that names an emptied branch beyond the single-qualifier shape.** An
   intersection of two clauses, a difference of two clause sets, and a multi-step fold still fall
   back to the plain miss. Every miss left in `C1:negation+relative-embedded` is one of those, so the
   cell's floor is this receipt. Carrying the intermediate through `evalBoolean` covers all of them,
   and it is also what would let the 11 clause-narrowed sets this round left on the general nudge
   say what actually emptied them.
5. **Instrument: judge both arms against one verdict-cache snapshot**, above. Three rounds in a row
   have hand-controlled for it, and this one had a 1.0 swing and a hard-fail flip on unchanged text.
6. **Instrument: the judge context's commit-count paragraph**, above. A re-baseline run rather than
   a lever round, since it re-judges the pool.
7. **C1 discourse-deixis** stays at the honest-miss floor at 0/25 green, waiting on its capability
   (`PLAN_DIALOGUE_ACTS.md`), not on tuning.

## Evidence / transcripts

Discriminating cases first.

### g-b2-coord-4 — tier-1 fail to pass

> which modules import app/lib/a.mjs or app/lib/b.mjs

Before: I can't tell what these options are alternatives about — nothing in "which modules import
app/lib/" reads as a subject term to check them against.

After: app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs and app/functions/d/handler.mjs.

The stem in the refusal is the tell: the sentence was cut at `a.`, which the marker regex read as
the "A" of an option list. The four modules are the union of the two import sets, which is what the
question asked for all along.

### g-c1-presup-4 — tier-1 fail to pass

> why does app/lib/a.mjs still import app/lib/b.mjs

Before: I can't tell what these options are alternatives about — nothing in "why does app/lib/" reads
as a subject term to check them against.

After: checking the presupposition first: app/lib/a.mjs doesn't import app/lib/b.mjs (no) — the
premise doesn't hold.

The presupposition lane was already there and already right. It never got the sentence. The same two
paths in a different cell, failing for the same reason, which is why the two levers the 5.0.41
decision log predicted turned out to be one.

### g-b1-neg-11 — judged 0.167 to 0.500

> which functions are not exported

Before: nothing in the index matches that (functions). Try "who touched \<a module that actually has
commits\>" or "/describe \<module\>" to see what's in the index.

After: nothing in the index matches that (functions). Try "which functions are exported" for that
branch on its own.

The verdict never changed — the empty set is the ground truth, since fnAlpha is the only function
and d/handler.mjs re-exports it. What changed is that the nudge is about exports, which is what the
question asked about, and it names a query that returns fnAlpha. The lead sentence is what the judge
still objects to, and it is item 1 on the board above.

### the branch a nudge offers has to answer — fixture probe, no pool case

> which functions are exported → fnAlpha().

A nudge that named an unsupported phrasing would trade one dead end for another. Both polarities of
every qualifier in the vocabulary compile, so this one cannot.

### a clause-narrowed set keeps the general nudge — fixture probe, no pool case

> modules importing scripts/g.mjs but not tested
>
> → nothing in the index matches that (modules). Try "who touched \<a module that actually has
> commits\>" …

Nothing imports scripts/g.mjs, so the clause is what emptied this, not the qualifier. Offering
"which modules are tested" here would point past the gap. These are the sets item 4 above is for.

### the enumerated forms still parse — fixture probe, no pool case

> Which fruit is it?
> (A) apple (B) pear
>
> → stem "Which fruit is it?", options A "apple", B "pear".

The parenthesized, dotted (`A.`) and colon (`A:`) forms all still parse, and a marker at the very
end of the text still closes its option. The rule added an edge requirement, not a form.
