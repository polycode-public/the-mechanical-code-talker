# PLAN_CI_INVARIANTS.md — architecture rules as graph facts, checked in CI

Placeholder, design-only. Drafted 2026-08-04 from operator direction; no implementation is
scheduled yet.

## The idea

A codebase has rules nobody enforces mechanically: "nothing outside adapters imports the
logger," "handlers never touch the store directly." Teach these to tmct's graph as facts, then
run them as queries in the CI pipeline. A query that returns a violation fails the build.

Tools like dependency-cruiser already check import rules. The difference here is that the rules
are taught in plain language rather than configured in a rule file, each rule carries the same
provenance tracking as any other fact tmct stores, and the graph a CI query checks is the same
graph an agent already queries at review time. One substrate serves both: the agent asks
questions about the codebase, and CI asserts the invariants over that same structure.

## What it stands on

- The code graph itself (`src/domain/codegraph.mjs`, `src/index/index-repo.mjs`), which already
  extracts imports, calls, and definitions into queryable individuals and edges.
- The ask/query engine (`src/domain/ask.mjs`), the layer a rule check would run its queries
  through.
- The teach lane and fact recognizer (`src/services/extract-facts.mjs`, and `chat.mjs`'s teach
  lane), which already turn plain-language sentences into stored, provenance-tagged facts. That
  is the mechanism an NL-taught invariant would reuse.
- The tool dispatch layer (`src/tools/server.mjs`) and CLI (`bin/tmct.mjs`), which already run
  headless, scriptable queries against a repo's graph. That is the shape a CI job would call
  into.
- The repo's own `npm run check:*` scripts (`package.json`), the existing CI-invariant pattern
  this would sit alongside.

## Open questions

- What does an invariant look like as a stored fact, and what does its query look like? A likely
  shape is a reusable pattern per rule type ("nothing outside X imports Y"), rather than one query
  per taught rule.
- Where do taught invariants live between runs: the repo's own `.tmct/` graph, checked in
  alongside the rules they check, or a separate persisted set?
- What counts as a CI-relevant violation versus a plain miss, where no matching edges were found
  at all and the rule cannot even be evaluated?
- Does a violation report cite the specific file/edge that broke the rule, the way an ask answer
  cites its source?

## First measurable step

Teach one real invariant about this repo in plain language (for example, "nothing outside
adapters imports config directly"), express it as a query over tmct's own code graph, and run it
against the current tree to see whether it correctly flags or clears the real import graph as it
stands today.
