# CHATBENCH_0.8.1 — transcript appendix (discriminating transcripts first)

Every excerpt below is a **verbatim** product row from
`chatbench/results/raw/run-0.8.1/product-a.jsonl` (deterministic replay,
`--stamp 0.8.1`), paired with the same case's 0.7.1 answer from the compare base
`chatbench/results/raw/run-0.7.1/product-a.jsonl`. The **0.8.1-specific** flips
(the quick-wins + the two playtests) are marked **[QW]** / **[PT]**; the flips
carried from 0.8.0 (pronoun / two-hop temporal / discourse-count levers) are
marked **[0.8.0]** and shown because the compare base is 0.7.1, so the diff is
cumulative.

---

## 1. The 0.8.1 quick-win + playtest flips (the surfaces that changed answer TEXT)

### [QW] friendly commit ref — author beside the sha (`who touched X`)

`gq-who-touched-a` (graph-query, fixed v1 spine):

```
visitor: who touched a.mjs
0.7.1  tmct: abc1234.
0.8.1  tmct: abc1234 (Ada Lovelace).           [via: composed]
```

Same flip on every "who touched / who touched it / who touched that/this /
which commit touched X / what was the last change to X" surface reached in the
draw: `mt-ask-then-touched`, `mr-graph-intact` (v1), `g-b1-pron-15/-19/-46`,
`g-b1-temp-14/-41`, `g-c1-temp-13/-17` (graded). The sha is now named with its
author — grounded in the fixture's `commit-abc` (author Ada Lovelace).

### [PT] authorship synonyms route off the grammar wall

The QW invited the authorship synonyms; the playtest routed them onto
`who touched X` (tmct has no separate authorship edge — "touched" IS the
authorship signal). Live-probe (fixture graph), all three now answer:

```
visitor: who wrote app/lib/a.mjs      → abc1234 (Ada Lovelace).   [was: grammar wall]
visitor: who authored app/lib/a.mjs   → abc1234 (Ada Lovelace).   [was: grammar wall]
```

In the draw, `g-c1-temp-24` / `g-c1-temp-25` (author-of-commit phrasings) flip
from the wall to an answer:

```
visitor: who is the author of abc1234
0.7.1  tmct: couldn't parse this as a graph question. Try: "when did <name> change" or "who touched <name>". …
0.8.1  tmct: commit abc1234 touched module app/lib/a.mjs; method Widget.render().   [via: composed]
```

(Honest caveat: this routes to the commit's touch-set rather than naming the
author string — an answer, not the grammar wall, but not the "(Ada Lovelace)"
render the direct `who touched X` gives. Recorded as a flip off the wall, not as
an authorship-naming win.)

### [QW] honest-empty coverage render — "No tests cover X"

```
visitor: what tests cover app/lib/a.mjs
0.7.1  tmct: No modules found whose module directly tests cover app/lib/a.mjs. (traversal: tests edges where object = app/lib/a.mjs)
0.8.1  tmct: No tests cover app/lib/a.mjs. (traversal: tests edges where object = app/lib/a.mjs)   [via: composed]
```

**Honest render artifact (not a regression):** the clean template is keyed to the
canonical verb "cover"; on the non-canonical synonym "what tests **touch** X"
(graded `g-a2-svo-11/-12`) it emits `No tests cover touch app/lib/f.mjs.` — the
stray verb leaks. Both tier-1 pass (honest miss); 0.7.1 was equally awkward
("No modules found whose module directly tests touch …"). Flagged as an
imperfect cleanup on the synonym path.

### [QW] singular "what is a test" + [PT] bare coverage survey

Live-probe (fixture graph):

```
visitor: what is a test
0.8.1  tmct: A test is code that exercises another unit and checks its behaviour.
             In this codebase, for example: app/unit-tests/b.test.mjs tests app/lib/b.mjs and
             app/unit-tests/b.test.mjs tests app/functions/d/handler.mjs (2 test edges). …   [via: corpus/seon]

visitor: what is untested          → app/lib/a.mjs, app/lib/c.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs and app/unit-tests/b.test.mjs.   [via: composed]
visitor: what needs tests          → (same set)   [via: composed]   [was: grammar wall]
```

---

## 2. The v1-spine multi-turn flip (tier-1 FAIL→PASS in 0.8.1's draw)

`mt-focus-drift` (multi-turn-focus) — the documented focus-drift weakness now
holds through the pronoun chain:

```
visitor: /describe app/lib/a.mjs
   tmct: app/lib/a.mjs — Module (id: mod-a) … ← imports (3) by app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs …
visitor: what calls it
   tmct: scripts/g.mjs.                                     [via: composed]
visitor: which modules import it
0.7.1  tmct: No modules found whose module directly imports it. (traversal: imports edges where object = Commit)
0.8.1  tmct: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.   [via: composed]
```

The `it → Commit` mis-bind is gone; "it" stays bound to the module in focus.

---

## 3. Flips carried from 0.8.0 (cumulative vs the 0.7.1 base)

### [0.8.0] pronoun / focus binding

```
g-b1-pron-15  visitor: who touched it
0.7.1  tmct: I answer questions about THIS codebase's structure … (grammar wall)
0.8.1  tmct: abc1234 (Ada Lovelace).                    [via: composed]   (+ QW author-name)

g-b1-pron-25  visitor: which modules import it
0.7.1  tmct: No modules found … where object = Commit
0.8.1  tmct: app/lib/f.mjs.                             [via: composed]
```

### [0.8.0] discourse-count anaphora

```
g-b1-disc-count-22  visitor: untested classes → Base and Button.
                    visitor: count them
0.7.1  tmct: I answer questions about THIS codebase's structure … (grammar wall)
0.8.1  tmct: 2 classes.                                 [via: composed]
```

### [0.8.0] C1 two-hop temporal (assembles; retrieves where data present)

```
g-c1-temp-9  visitor: when did the module that defines fnAlpha change
0.7.1  tmct: this could mean more than one thing: 1) touches … 2) defines … — try rephrasing …
0.8.1  tmct: the module in that set was last touched by commit abc1234 on 2026-06-28 ("Render the widget with full mode").   [via: composed]

g-c1-temp-22 visitor: when did the module that imports app/lib/b.mjs change
0.8.1  tmct: no recorded commit touched the 1 module in that set in this index.   [via: composed]  (assembles, data absent → honest)
```

### [0.8.0] playtest discourse chains (B2 describe → pronoun)

`g-b2-disc-10` / `g-b2-disc-23`: `/describe X` → `what calls it` → `which
modules import it` resolve the pronoun through the describe focus
(`app/lib/e.mjs` / `app/lib/f.mjs`), documented-weakness turns now passing.

---

## 4. Reproducibility scrub (deterministic rows)

The ACE fact-recall citation, which carried a volatile session id + timestamp in
0.7.1, is scrubbed to `ace:chat:<session>@<ts>` in 0.8.1 so replayed rows are
byte-stable (`g-b2-assert-14`, `g-c1-assert-12`). `mr-asked-before` still carries
a live session id/date in its recall line (volatile-by-design; the only v1 change
that is pure id drift, not behavior).
