# Example: mini-webapp

A small, ready-made code graph for **Questboard**, a fictional task-tracker web
app. It ships as `.tmct/graph.json` so you can see tmct answer real questions
without building a graph of your own.

```bash
npm run example:mini
# or, from an installed tmct:
tmct chat --repo examples/mini-webapp
```

## What's in it

- **12 modules** across `src/core`, `src/lib`, `src/server`, `src/handlers`,
  and `test/` (2 test modules).
- Two class hierarchies:
  - `Record` ← `Task`, `User`, `Project` (the domain models, `src/core/model.mjs`)
  - `Controller` ← `TaskController`, `UserController` (the HTTP handlers)
- `imports`, `calls`, `callsSymbol`, `tests`, `defines`, `contains`,
  `inherits`, `touches`, `touchesSymbol`, and `cochange` edges, plus 8 commits
  of history.

## Questions it can answer

```
what classes are there
describe Task
how many modules
which modules import src/core/model.mjs
what tests cover src/handlers/tasks.mjs
who touched src/core/store.mjs
what does src/core/store.mjs change together with
```

The graph is a plain JSON artifact — open `.tmct/graph.json` to see the exact
OWL-labelled shape tmct consumes (`seon:` / `mgx:` predicates).
