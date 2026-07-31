# Example: tiny-webapp-src

A small, plain-JavaScript source tree — real modules to point `tmct index` at,
not a pre-built graph like `examples/mini-webapp`. Pure Node.js, no `package.json`,
no npm dependencies.

```bash
node bin/tmct.mjs index --repo examples/tiny-webapp-src
```

## What's in it

Five modules, a tiny task-list app:

- `app.mjs` — entry point; wires the store and the renderer together.
- `lib/parse.mjs` — `parseRow`, turning a raw text line into a task record.
- `lib/store.mjs` — loads rows via `parseRow`, and looks them up.
- `lib/render.mjs` — turns rows into text lines for display.
- `util/format.mjs` — formatting helpers shared by the renderer.

Its own test suite lives in `test/` (`node:test`, no dependencies):

```bash
node --test test/*.test.mjs
```

## The refactor target

`parseRow` (`lib/parse.mjs`) has exactly two call sites, one per importing
module: `lib/store.mjs`'s `loadRows` and `app.mjs`'s `previewFirstRow`. That is
deliberate — this fixture is PLAN_CODE_PLANNING.md Track 5's first milestone target: a
planned two-step refactor (rename `parseRow`, then move it to a sibling module,
updating both importers) verified by re-running this test suite after each
step.
