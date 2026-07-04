// @polycode-projects/the-mechanical-code-talker (tmct) — library entry point.
//
// tmct began as a whole-package lift of an earlier chat surface (see README
// provenance). Internal module filenames and symbols were kept to preserve the
// shape and its green test suite; the branding throughout is now `tmct`.
//
// This entry re-exports the adapter primitives a library consumer needs. The
// clean chat/primitives split (ROADMAP item 13) is done: the movable
// conversational grammar lives in src/interpret/ (normalization pre-pass, the
// registered parsing strategies, the merge rule), while ask.mjs keeps the core
// primitives (resolveObject, traverse, render) and the ask() orchestration.

// Chat surface (also reachable as the `./chat` subpath export).
export { runChat, COMMANDS, answerCount, renderStats } from "./chat.mjs";

// Grammar / NL-over-graph primitives.
export { ask, resolveObject } from "./ask.mjs";

// The interpretation pipeline (ROADMAP item 8): normalize once, run every
// registered strategy (grammar, keyword-spot, …) over the text, merge same-class
// results, surround distinct-class results — no graph access; pair it with ask()
// or the primitives to answer. `interpret(text, ctx)` returns the full record
// ({raw, normalized, normalizationChanged, results, parsed, class, alternates}).
export { interpret } from "./interpret/pipeline.mjs";

// Graph traversal primitives.
export { relationKind, impactClosure } from "./codegraph.mjs";

// Tool dispatch (slash-commands and CLI tool calls route through here).
export { dispatchTool } from "./server.mjs";

// Conversational memory (ROADMAP item 9) — tmct's OWN OWL-labelled graph under
// .tmct/memory/, distinct from any provider-supplied code graph.
export { loadMemory, appendUtterance, appendFact } from "./memory/core.mjs";
export { retrieveBlocks, saveBlock, rankBlocks } from "./memory/blocks.mjs";
export { foldSessionLogs } from "./memory/fold.mjs";

// The single graph-load choke point — the adapter's data-provider seam
// (docs/adapter-contract.md): registerProvider() plugs a producer in;
// fetchEntities() is the one read path.
export { fetchEntities, registerProvider } from "./source.mjs";
