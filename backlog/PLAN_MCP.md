# PLAN_MCP.md — an MCP server over the query engine

Placeholder, design-only. Drafted 2026-08-04 from operator direction; no implementation is
scheduled yet.

## The idea

Coding agents rebuild a picture of a codebase by grepping and reading files into context. That
costs thousands of tokens per question, gives no way to check the answer, and repeats every
session. tmct already holds a persistent graph that answers questions like "what calls
store.mjs" in milliseconds, for $0, with file-level citations attached to every answer.

Expose that query engine over MCP (`tmct mcp`). Any MCP-speaking agent, whether Claude Code,
Cursor, or another agent framework, can then query the graph directly instead of re-deriving it
from raw files. The claim to test: cited, deterministic context beats grep-and-read on tokens
spent per correct answer. `idxbench` and `synthbench`, the harnesses that already grade
code-index fidelity and code synthesis, are the rigs to run that comparison on.

MCP keeps tmct's constitution intact. The LLM stays outside, as the client asking the questions.
tmct's own answer path does not change: a deterministic lookup over the graph that grounds an
answer or refuses it.

## What it stands on

- The tool dispatch layer (`src/tools/server.mjs`), which already exposes graph-query tools
  (`dispatchTool`/`dispatchToolStructured`) behind one internal entry point.
- The ask domain (`src/domain/ask.mjs`) and its tool handler (`src/tools/handlers/tmct-ask.mjs`),
  the query engine an MCP surface would wrap.
- `src/surfaces/http/server-http.mjs` (`tmct serve`), an Anthropic Messages API-compatible HTTP
  endpoint over the same zero-model engine, at zero token cost. It already shows the shape of
  exposing tmct's tool layer behind an external wire protocol.
- The Repository Interface (`src/adapters/repository-interface.mjs`,
  `docs/repository-interface.md`), the versioned contract seonix already implements to supply
  tmct a graph. That is a working example of the query engine serving an external consumer over a
  stable seam.
- `idxbench` and `synthbench` (`test-benchmarks/idxbench/`, `test-benchmarks/synthbench/`), the
  existing measurement rigs for code-index fidelity and code synthesis.

## Open questions

- Which tools does an MCP surface expose first: the read-only graph queries only, or does
  `tmct_ingest` belong in an agent-facing MCP server too?
- Does `tmct mcp` reuse `server-http.mjs`'s shim shape, or does MCP's own transport (stdio, SSE)
  need a separate surface module?
- How is the tokens-to-correct-answer comparison against grep-and-read actually run? A likely
  shape is the same question set through a real agent twice, once with MCP tools and once
  without.

## First measurable step

Wire one read-only tool (a "what calls X" query) through a minimal MCP stdio server, then run it
against the same question set `idxbench` already grades, once via MCP and once via a
grep-and-read baseline, and record tokens spent per correct answer. That number's long-term home
is the receipts page ([archive/PLAN_RECEIPTS.md](../archive/PLAN_RECEIPTS.md)).
