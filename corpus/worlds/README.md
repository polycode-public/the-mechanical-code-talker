# corpus/worlds/

The shipped worlds pack: the game worlds the chat adventure lane can load on
request ("play ashcombe hall"), with a gzipped world index consulted first
and exactly one gzipped JSONL shard loaded per world
(src/adapters/corpus/worlds-pack.mjs). A world stays on disk until a session
asks for it; loading one appends its rows into that session's memory store
under `world:<name>` provenance. Layout:

- `src/<world>.jsonl` — the hand-authored source, one per world. Original
  content, written for this repository; no text is copied from any book,
  game or other IP.
- `index.json.gz` — `{ worldName: { s } }`: the shard holding that world.
- `shards/<world>.jsonl.gz` — one JSON row per line: `fact` rows (the
  world's graph triples: rooms, exits, placements, cast), `rule` rows (the
  world's pre-built action families, the same four action-Rule kinds the
  live teach frames store), and one `meta` row (the opening line). Shapes in
  src/domain/worlds-pack.mjs.
- `manifest.json` — counts, budgets, source and file hashes. No build date:
  same sources in, same bytes out.

Rebuild with `npm run gen:worlds-pack`. The budgets in the build script are
caps, not targets — a world that breaks one gets cut, the number stays.

Licence: first-party, MPL-2.0 like the rest of the repository (see
corpus/LICENSES.json).
