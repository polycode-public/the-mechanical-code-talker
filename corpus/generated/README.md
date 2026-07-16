# corpus/generated/ — mechanically-generated ACE surface variants

`ace-surface-variants.jsonl` — archive/PLAN_BREADTH_FIRST_NLU.md §6a's raw material for
tmct's "richer template/surface-realization variety" goal. Never an LLM, never
invented text: every row is a real seed sentence with one word swapped for a
real WordNet synset sibling, or a real sentence's alternate ACE-grammar-
declared surface form. Every row is self-verified — it re-parses against
tmct's own `parseAce` (`src/domain/grammar/ace.mjs`) before being written; a swap
that doesn't re-parse is dropped, never committed.

Regenerate: `node scripts/generate-template-variants.mjs`. Coverage
measurement: `node scripts/template-coverage.mjs` (baseline) and
`node scripts/template-coverage.mjs --rescue corpus/generated/ace-surface-variants.jsonl`
(after). See `archive/PLAN_TEMPLATE_COVERAGE.md` for the design and the real
before/after numbers.

## Row shapes

| `kind` | What | Fields |
|---|---|---|
| `rescue` | A real docs-corpus sentence that almost fit the ACE grammar (exactly one undeclared word), rescued by substituting a WordNet synonym of that word that's ALSO already declared in `src/domain/grammar/lexicon-core.json` | `sentence`, `rescued`, `from`, `to`, `pos`, `synsetId`, `sourceFile` |
| `variant` | A real WordNet/SemCor example sentence (`corpus/tier2/human-examples*.jsonl`) that already hits `parseAce`, with one content word swapped for a same-synset sibling (both ends independently declared in tmct's own lexicon) | `seed`, `generated`, `from`, `to`, `pos`, `synsetId`, `sourceCorpus` |
| `alt-phrasing` | A possessive-pattern (#7) hit rewritten in the ACE grammar's OTHER declared surface form for the same triple (`"X's Y is Z"` <-> `"the Y of X is Z"`, both routed through `buildPossessive` in `src/domain/grammar/ace.mjs`) | `seed`, `generated`, `pattern`, `form` |

Every row also carries `provenance` (`wordnet:<synsetId>` or
`grammar:ace.mjs pattern 7 (possessive) — …`).

## Not wired into the product path

This corpus is not loaded by `src/chat.mjs`/`src/domain/ask.mjs` or any other
product code — it is committed raw material, verified by
`scripts/template-coverage.mjs`, per archive/PLAN_BREADTH_FIRST_NLU.md §6's explicit
non-goal. Wiring it into live answer rendering is a separate, future phase.

## Licence

Open English WordNet content (synset `members`/`example` fields) is
CC-BY-4.0; SemCor-derived sentences (`corpus/tier2/human-examples-large.jsonl`)
are CC-BY-4.0 per that fork's own `LICENSE.md` (same basis `corpus/README.md`
already documents for that file). A `variant`/`rescue` row is a one-word
derivative of that material — CC-BY-4.0. An `alt-phrasing` row is a pure
grammar-level rephrasing of the same source sentence — CC-BY-4.0 also, no new
creative content introduced either way.
