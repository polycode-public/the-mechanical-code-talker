# corpus/namenet — the committed Open English Namenet conversion

`namenet.jsonl` is a mechanical, ConceptNet-shape conversion of **three
human-reviewed linking tables from the Open English Namenet project** — one
`/r/Synonym` row per accepted name/label link:

```json
{"start":"/c/en/canis_lupus","rel":"/r/Synonym","end":"/c/en/wolf","weight":2,"surfaceText":"[[Canis lupus]] means the same as [[wolf]]"}
```

**Licence: CC-BY-4.0** as this repository's conservative label — the source
repository declares no explicit licence of its own. Read `LICENSE-NOTICE` in
this directory before redistributing more widely.

## Provenance

- **Source:** three reviewed CSVs (`species_reviewed.csv`,
  `taxon2common_reviewed.csv`, `linked_occupations_reviewed.csv`) from a local
  uncommitted checkout of
  [globalwordnet/english-namenet](https://github.com/globalwordnet/english-namenet)
  — never vendored into this repository. Species rows also cross-reference a
  local Open English WordNet checkout (the same source
  `corpus/wordnet/generate.mjs` reads) to resolve synset ids into lemmas.
- **Why every row is `/r/Synonym`:** each accepted CSV row links two
  name-lists a human reviewer confirmed denote the SAME real-world thing (a
  species, a folk-taxonomic category, an occupation) — never a
  broader/narrower or capability relation. See `generate.mjs`'s header comment
  for the accept/skip rules per source file.
- The output is indexed with a byte count and sha256 checksum in
  `manifest.json`.

## How to regenerate

```
node corpus/namenet/generate.mjs [namenetDir]
TMCT_NAMENET_DIR=/path/to/english-namenet node corpus/namenet/generate.mjs
```

A maintainer tool, run by hand, offline.
