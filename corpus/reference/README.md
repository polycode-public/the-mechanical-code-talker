# corpus/reference/

The shipped reference pack: cleaned Simple English Wikipedia leads the
clean-miss lookup answers from, with a gzipped term index consulted first and
exactly one gzipped JSONL shard loaded per hit (src/adapters/corpus/
reference-pack.mjs). Layout:

- `index.json.gz` — `{ term: { s, t, r } }`: shard name, canonical term key,
  revision id. Redirect titles appear as alias entries pointing at their
  target's row.
- `shards/ref-00.jsonl.gz` … `ref-3f.jsonl.gz` — one JSON row per article:
  `{ term, title, text, summary, url, revid, isa? }`, sharded by the term's
  FNV-1a first byte mod 64 (src/domain/reference-pack.mjs).
- `manifest.json` — the pinned dump (URL, mirror, date, sha256), build date,
  counts, budgets and a sha256 for every emitted file.
- `LICENSE-NOTICE` — CC BY-SA 4.0; read it before reusing these files.

Rebuild with `npm run gen:reference-pack` (downloads the dump into
~/.cache/tmct-reference/ on the first run). Same dump in, same bytes out.
