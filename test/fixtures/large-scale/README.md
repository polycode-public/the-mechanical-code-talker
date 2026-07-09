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

No `.tmct/` is ever committed here — any test using this fixture must build its
own graph fresh (ephemeral/tmpdir), per this repo's own CLAUDE.md convention.
