# tmct playtest 015 — instance names through the code-graph ask lanes

Version under test: 1.11.5 (working tree, post-backlog batch).
Probe recipe: fresh scratch repo per session — `S=$(mktemp -d); node bin/tmct.mjs init
--repo "$S"; printf '…\n/exit\n' | node bin/tmct.mjs chat --repo "$S"`; diagnosed with
`TMCT_NARRATE=1`.

Area: hyphenated/numbered instance names (disk-1, peg-a) swept through the code-graph
ask/resolve lanes — the one Phase-1R boundary sweep never run.
Axes explored this iteration: instance-name shapes in the where/describe/reverse ask lanes.
Axes explored so far: relation coverage of forward yes/no (001), honesty on miss (003),
negation (002), anaphora (004), inference depth (005), teach-side variation (011),
politeness rungs (012), multi-word terms, quantifiers (010), teach/query boundary (013),
comparative seed (009), prepositional-verb facts (014), instance-name ask lanes (this).
Axes still untouched: contractions and cleft rungs of the paraphrase ladder,
passive↔active beyond UsedFor.

## test: a where question about a taught instance answers its taught location

### Expectations

**Given** (a fresh store, three teaches):

```txt
tmct> disk-1 is a disk.
noted — remembered: disk-1 is a kind of disk
tmct> peg-a is a peg.
noted — remembered: peg-a is a kind of peg
tmct> disk-1 rests on peg-a.
noted — remembered: disk-1 rests on peg-a
```

**When**: `where is disk-1`

**Expected**: the taught location fact ("disk-1 rests on peg-a"), cited.

**Actual** (before the fix): the code-graph where lane's module miss —
`no module matching "disk-1" found in the index. Try "who touched <a module that
actually has commits>" …` — even though "what does disk-1 rest on" answers the fact.
The describe lane falls back to memory facts for the same term; the where lane never did.

Minimal pair: `where is disk-1` (miss) vs `what does disk-1 rest on` (pass).

### Result

Fail.

### Second edge (adjacent, folded in): a teach turn leaks a misparse Canonical

With both terms known, the teach turn `disk-1 rests on peg-a.` printed:

```txt
Canonical: does "disk-1" tests "peg-a."? — ask(tests, subject="disk-1", "peg-a.")
```

"rests" is not ask vocabulary; keyword-spot's tier-3 bounded-edit-distance repair
rewrote it to "tests" (distance 1) and the teach lane, which correctly took the turn
over and revised the goal line, left the structural parse's canonical standing — a
receipt for a question nobody asked, with the sentence-final period still inside the
term. Contrast the legitimate teach canonical the README transcript pins ("father is a
kind of parent" restated as inherits): that parse is exact-vocabulary, not a repair.

### Fix

Layer: `src/chat.mjs` fact readers + `src/interpret/strategies/keywords.mjs`.

1. New `(a-pre4)` reader in `factAnswer`: `where is <term>[ now]` over taught locative
   facts (the folded prepositional-verb predicates, `mgx:rest-on` family, closed
   locative-preposition tail). Miss-gated AND hit-gated: consulted only after the code
   lane missed, takes over only when a locative fact row for that exact subject exists —
   a real module answer and every no-fact miss are untouched.
2. Keyword-spot's tier-3 fuzzy verb repair now stamps its AST (`fuzzyVerb: true`), and
   the teach lane drops a canonical built from a fuzzy-repaired parse. Exact-vocabulary
   teach canonicals (the README-pinned inherits restatement) are kept.

Regression tests: `test/chat-where-taught-instance.test.mjs` (5 tests — the locative
answer, the "now" tail, the no-fact honest miss, a non-locative relation never answering
a where question, and the teach turn carrying no fuzzy-misparse canonical).

Known remainder: the where lane's Goal line for `where is disk-1 now` still reads the
object as "disk-1 now" (the code-lane parse never strips the tail); the answer itself is
right. Cosmetic, noted for a future goal-line pass.

### Retest

```txt
tmct> where is disk-1
you told me: disk-1 rests on peg-a (source: teach:chat:…)
tmct> where is disk-1 now
you told me: disk-1 rests on peg-a (source: teach:chat:…)
tmct> where is nonexistent-9
no module matching "nonexistent-9" found in the index. …
tmct> disk-1 rests on peg-a.
noted — remembered: disk-1 rests on peg-a
(no Canonical line)
```

### Retest result

Pass. Full suite green; CLI smoke green.
