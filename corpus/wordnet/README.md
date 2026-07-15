# corpus/wordnet — the committed Open English WordNet conversion

`wordnet-xl.jsonl` and `wordnet-full.jsonl` are a mechanical, ConceptNet-shape
conversion of **real Open English WordNet (OEWN) structural relation data** —
one row per relation edge or synonym-chain pair:

```json
{"start":"/c/en/dog","rel":"/r/IsA","end":"/c/en/canine","weight":2,"surfaceText":"[[dog]] is a kind of [[canine]]"}
```

**Licence: CC-BY-4.0** (Open English WordNet-derived data; NOT this repo's
MPL-2.0) — see `LICENSE-NOTICE` in this directory for the full attribution.

## Provenance

- **Source:** the Open English WordNet YAML synset source
  (`src/yaml/{noun,verb,adj,adv}.*.yaml`, 107,526 synsets), read from a local
  uncommitted checkout of
  [globalwordnet/english-wordnet](https://github.com/globalwordnet/english-wordnet)
  — never vendored into this repository.
- **What is read:** each synset's structural fields (`hypernym`, `mero_part`,
  `mero_member`, `mero_substance`, `causes`, `attribute`, `similar`, `also`,
  `members`) — never the `definition`/`example` free prose.
- `wordnet-xl.jsonl` is a bounded ~24,000-fact prioritized subset (hypernym
  backbone plus synonym chains for the most-referenced synsets);
  `wordnet-full.jsonl` is the complete conversion. Both are indexed with byte
  counts and sha256 checksums in `manifest.json`.

## How to regenerate

```
node corpus/wordnet/generate.mjs [yamlDir]
TMCT_WORDNET_YAML_DIR=/path/to/yaml node corpus/wordnet/generate.mjs
```

A maintainer tool, run by hand, offline. See `generate.mjs`'s header comment
for the full relation-mapping table and direction rules.
