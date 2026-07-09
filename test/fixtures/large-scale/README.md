# large-scale fixture

Source-only subsets of two real upstream projects, vendored to reproduce a
disambiguation-candidate-ranking bug at a realistic multi-file, cross-"repo"
scale — one seonix found on a 27,929-module production estate but that never
reproduced on tmct's own tiny `examples/mini-webapp` / `examples/polyglot`
fixtures.

- `js-commander/` — commander.js (TJ Holowaychuk et al.), MIT. `index.js` +
  `lib/` only.
- `js-express/` — express.js (TJ Holowaychuk et al.), MIT. `index.js` + `lib/`
  only.

No `.git`, `node_modules`, tests, or build config — just source + each
project's original `LICENSE` file, retained per MIT's attribution term.

`.tmct/graph.json` IS committed here (an exception to tmct's usual `.tmct/`
convention, allow-listed in `.gitignore` the same way `examples/*/.tmct/
graph.json` is) — it's a pre-built, one-time artifact, not something tests
regenerate. It was built by running seonix's own indexer
(`seonix cli index_repository '{"repo_path":"<abs path to this dir>"}'`)
against this fixture, expanding the resulting v2 interned wire format back to
tmct's plain edge shape (`expandGraphPayload` from seonix's
`src/graph-format.mjs` — seonix's on-disk graph.json is id-interned; tmct's own
graph reader expects the expanded shape, the same one
`examples/mini-webapp/.tmct/graph.json` uses), then merging in tmct's static
schema documentation via `ingestSchemaDocs` (`src/schema-docs.mjs`), mirroring
`scripts/build-demo-graph.mjs`'s own precedent. Tests load it read-only via
`createSession({ repoPath: "test/fixtures/large-scale", env: {}, ephemeral:
true })` — same ephemeral-session pattern as `test/chatflow-tier4.test.mjs`.

To rebuild after re-vendoring or upgrading the fixture sources: re-run the
seonix indexer against this directory, expand + re-ingest schema docs as
above, and overwrite `.tmct/graph.json`.
