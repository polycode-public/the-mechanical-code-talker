# PLAN_TEMPLATE_COVERAGE.md — ACE-grammar coverage harness and generated surface variants

PLAN_BREADTH_FIRST_NLU.md §6, track 4. A coverage harness against real, human-written prose
(`scripts/template-coverage.mjs`), and a generation script that turns real local sentences into
verified ACE-grammar-fitting variants (`scripts/generate-template-variants.mjs`). Both are
maintainer-only tooling: neither is imported by `src/` or `bin/`, and neither runs under `npm
test`. Written during implementation, recording the real decisions and the real numbers.

## The corpus

This repo's own root-level `*.md` docs: 41 files, 2,949 sentences after splitting. Real,
human-written prose about a real codebase, already committed, MPL-2.0 — no licensing question.

The plan's other candidate, SemCor's sense-tagged text (`~/projects/globalwordnet/semcor`), turned
out to store each sentence as a `text:` field inside a custom YAML dialect built for Python
tooling. Extracting it cleanly would mean writing (or reusing) a YAML reader for a second corpus,
for no real gain over the docs corpus already sitting in the repo. Docs won on simplicity, per the
plan's own fallback.

`scripts/lib/text-corpus.mjs` does the splitting: strip fenced code blocks, strip markdown
structural noise (headers, tables, list markers, inline code/link syntax), then split on
`.`/`?`/`!` followed by whitespace and a capital letter. A plain regex splitter, not an NLP
sentence segmenter, exactly as the plan calls for. It over-splits on abbreviations sometimes; those
fragments just come out as honest misses.

## The harness

`scripts/template-coverage.mjs` runs every sentence through `parseAce`
(`src/grammar/ace.mjs`) and sorts it into one of three buckets:

- **hit** — a pattern matched and every word resolved: a real OWL triple would be emitted.
- **residue** — the sentence's *shape* matched one of the 8 patterns, but at least one word
  wasn't declared in `src/grammar/lexicon-core.json`.
- **miss** — no pattern fit at all.

```
node scripts/template-coverage.mjs
node scripts/template-coverage.mjs --rescue corpus/generated/ace-surface-variants.jsonl
```

## Baseline coverage

```
41 markdown files, 2,949 sentences
  hit:     0    (0.0%)
  residue: 1,781 (60.4%)
  miss:    1,168 (39.6%)
```

(Measured before this doc existed. Once committed, this file becomes the corpus's 42nd file —
re-running shifts the totals by the sentences in this doc itself, moving the percentages by well
under half a point. Every future `*.md` at repo root does the same; the harness measures whatever
the docs tree currently holds, by design.)

Zero hits. This is the honest number, and it's the expected one: the ACE grammar
(`docs/references/schemas/ace-owl-fragment.md`) is a controlled-English sub-fragment with 8 rigid
sentence shapes (`every N1 is a N2`, `N1 VERB N2`, `N1's N2 is X`, …), not a parser for arbitrary
English. Real prose runs subordinate clauses, adverbs, multi-word phrases, and punctuation the
8 patterns were never built to admit. 60.4% of sentences get close enough to match a pattern's
*shape* — the grammar recognises "this looks like a copula/relation/possessive sentence" — but
almost every one carries at least one word (frequently a pronoun, preposition, or a hyphenated
compound like `append-only`) the patterns don't have a slot for.

We also measured the seed pool used for generation below: `corpus/tier2/human-examples.jsonl`,
`human-examples-medium.jsonl`, and `human-examples-large.jsonl` (2,404 real WordNet/SemCor
example sentences, already committed). 6 of those 2,404 hit outright — a similarly small number,
for the same structural reason.

## Generation

`scripts/generate-template-variants.mjs` writes `corpus/generated/ace-surface-variants.jsonl`.
Every row is a mechanical, sourced-from-real-data transform, and every row is self-verified: it's
re-run through `parseAce` before being written, and dropped if it doesn't hit. Three techniques:

1. **Rescue.** Take a docs-corpus sentence with exactly one undeclared (residue) word. Look up
   that word's real WordNet synset (`~/projects/globalwordnet/english-wordnet`, reusing the
   YAML reader already built for `scripts/extract-persona-sources.mjs`). If any other member of
   that synset is *also* already declared in tmct's own lexicon, for the same part of speech,
   swap it in. Both ends of the swap are tmct's own curated vocabulary — WordNet only supplies
   the evidence they're genuine synonyms.
2. **Variant.** Same synonym-swap technique, applied to the 6 real sentences from
   `corpus/tier2/human-examples*.jsonl` that already hit `parseAce` outright — producing
   same-meaning surface variety for the shapes real prose actually reaches.
3. **Alt-phrasing.** The possessive pattern (#7) is the one place the ACE grammar itself declares
   two surface forms for the same triple — `"X's Y is Z"` and `"the Y of X is Z"`, both routed
   through `buildPossessive` in `src/grammar/ace.mjs`. For each possessive-pattern hit, generate
   the sentence's other form and verify it re-parses to the same triple shape.

Never generated: passive voice (no ACE pattern supports it) or NomLex-style nominalization
(`destroy`↔`destruction`) — the real NomLex data isn't present locally, only its schema, exactly
as the plan scopes out.

### What it produced

```
node scripts/generate-template-variants.mjs
  1/3 rescue:  16 single-residue-word docs sentences checked, 8 distinct residue words looked up
               in WordNet → 0 rescued
  2/3 seeds:   6 real sentences already hit parseAce
  2/3 variant: 14 generated
  3/3 alt-phrasing: 3 generated
  17 total rows written to corpus/generated/ace-surface-variants.jsonl
```

The rescue pass found zero swaps. The 8 residue words it checked were dominated by pronouns
(`this`, `that`), a preposition-adjacent case, and one or two content words (`danger`, `sacred`)
whose WordNet synonyms simply aren't in tmct's own 93-verb/60-adjective/9,307-noun lexicon. That
lexicon is already broad on the noun side (WordNet-derived itself), so a same-synset rescue only
fires when tmct happens to have independently declared *two* words from the same synset — a
narrow coincidence this run didn't hit. Zero is the real, unpadded answer.

The 14 variant rows and 3 alt-phrasing rows are genuine: e.g. `"the piece has a fast rhythm"` →
`"the piece has a fast beat"` (`rhythm`/`beat`, synset `07100710-n`), and `"the quality of mercy
is not strained"` → `"mercy's quality is not strained"` (possessive pattern's other form). One
swap reads archaic — `"the ace of trumps is a sure winner"` → `"the one of trumps is a sure
winner"` (`ace`/`one`/`single`/`unity` do share WordNet's "smallest whole number" synset,
confirmed against the synset's own definition and example) — a real, same-sense substitution
that happens to sound dated to a modern reader. This report checks sense correctness, and
discloses naturalness as a separate, unaddressed concern.

## After coverage

```
node scripts/template-coverage.mjs --rescue corpus/generated/ace-surface-variants.jsonl
  hit:     0    (0.0%)
  residue: 1,781 (60.4%)
  miss:    1,168 (39.6%)
  rescued: 0
  after:   0/2,949 (0.0%) hit-or-rescued
```

The docs-corpus coverage number does not move. The harness ran, found real rescue candidates, and
correctly reported that none of them cleared the bar — that's a genuine zero-yield result, not a
harness shortfall. Padding this with the 17 generated rows by counting
them as part of the measured corpus would inflate the number without saying anything true about
how much of *real, unrelated* prose the grammar covers, so this report keeps the two figures
separate: docs-corpus coverage (0/2,949, unchanged) and generated-corpus yield (17 rows, 100%
self-verified by construction, since an unverified row is never written).

## Honest framing

The ACE grammar's ceiling on free-form prose is low, and that's structural, not a defect this
pass could fix. Growing that ceiling means writing more grammar patterns or declaring more
vocabulary — both real work, out of scope here. What this phase delivers is the two things the
plan actually asked for: a real, repeatable, checkable coverage number (0/2,949 hit, 60.4%
shape-only), and a first, small, fully-verified batch of generated surface variants (17 rows) as
raw material for future template/output variety — not a claim that free-form English input
coverage improved.

## Files

- `scripts/lib/text-corpus.mjs` — markdown corpus loader + sentence splitter.
- `scripts/lib/wordnet-synonyms.mjs` — WordNet synset lookups, reusing
  `scripts/extract-persona-sources.mjs`'s YAML reader (now also exports `loadSynsets`/
  `loadEntriesFor` for this reuse).
- `scripts/template-coverage.mjs` — the coverage harness (Part A).
- `scripts/generate-template-variants.mjs` — the generator (Part B).
- `corpus/generated/ace-surface-variants.jsonl` + `manifest.json` + `README.md` — the committed
  output.

## Non-goals confirmed unchanged

Nothing here touches `src/chat.mjs`, `src/ask.mjs`, `src/grammar/lexicon-core.json`, or any other
product-path file. `npm test` (1,919 tests) passes unaffected — this phase is corpus and tooling
only.
