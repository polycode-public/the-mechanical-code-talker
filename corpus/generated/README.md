# corpus/generated/ — mechanically-generated ACE surface variants

`ace-surface-variants.jsonl` — raw material for tmct's "richer
template/surface-realization variety" goal. Never an LLM, never
invented text: every row is a real seed sentence with one word swapped for a
real WordNet synset sibling, or a real sentence's alternate ACE-grammar-
declared surface form. Every row is self-verified — it re-parses against
tmct's own `parseAce` (`src/domain/grammar/ace.mjs`) before being written; a swap
that doesn't re-parse is dropped, never committed.

Regenerate: `node scripts/generate-template-variants.mjs`. Coverage
measurement: `node scripts/template-coverage.mjs` (baseline) and
`node scripts/template-coverage.mjs --rescue corpus/generated/ace-surface-variants.jsonl`
(after).

## Row shapes

| `kind` | What | Fields |
|---|---|---|
| `rescue` | A real sentence from the frozen prose corpus (`corpus/prose/`) that almost fit the ACE grammar (exactly one undeclared word), rescued by substituting a WordNet synonym of that word that's ALSO already declared in `src/domain/grammar/lexicon-core.json` | `sentence`, `rescued`, `from`, `to`, `pos`, `synsetId`, `sourceFile` |
| `variant` | A real WordNet/SemCor example sentence (`corpus/tier2/human-examples*.jsonl`) that already hits `parseAce`, with one content word swapped for a same-synset sibling (both ends independently declared in tmct's own lexicon) | `seed`, `generated`, `from`, `to`, `pos`, `synsetId`, `sourceCorpus` |
| `alt-phrasing` | A possessive-pattern (#7) hit rewritten in the ACE grammar's OTHER declared surface form for the same triple (`"X's Y is Z"` <-> `"the Y of X is Z"`, both routed through `buildPossessive` in `src/domain/grammar/ace.mjs`) | `seed`, `generated`, `pattern`, `form` |

Every row also carries `provenance` (`wordnet:<synsetId>` or
`grammar:ace.mjs pattern 7 (possessive) — …`).

## Not wired into the product path

This corpus is not loaded by `src/services/chat.mjs`/`src/domain/ask.mjs` or any other
product code — it is committed raw material, verified by
`scripts/template-coverage.mjs`. Wiring it into live answer rendering is a
separate, future phase.

## Licence — CC-BY-SA-4.0

**`ace-surface-variants.jsonl` is CC-BY-SA-4.0**, and this file ships in the npm
package. It is not under this repository's MPL-2.0.

Two source licences meet in this file:

- Open English WordNet content (synset `members`/`example` fields) is CC-BY-4.0;
  SemCor-derived sentences (`corpus/tier2/human-examples-large.jsonl`) are
  CC-BY-4.0 per that fork's own `LICENSE.md` (the same basis `corpus/README.md`
  already documents for that file). `variant` and `alt-phrasing` rows derive
  from this material.
- `corpus/prose/` feeds the `rescue` rows, and it includes Wikipedia text under
  **CC-BY-SA-4.0** (`corpus/prose/wikipedia/LICENSE-NOTICE`). A `rescue` row
  quotes such a sentence and substitutes one word into it, so the row is a
  published, modified derivative of CC-BY-SA-4.0 text.

Share-alike is viral, so the combined file takes the stricter licence:
**CC-BY-SA-4.0**. Redistributing it, modified or not, means doing so under
CC-BY-SA 4.0 with the attribution in `corpus/prose/wikipedia/LICENSE-NOTICE`.

This file was labelled CC-BY-4.0 while the rescue corpus was this repository's
own MPL-2.0 docs. Repointing the corpus at Wikipedia is what changed it.
`corpus/prose/sqlite/` is public domain and adds no condition of its own.
