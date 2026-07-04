// @polycode-projects/the-mechanical-code-talker (tmct) — library entry point.
//
// tmct began as a whole-package lift of an earlier chat surface (see README
// provenance). Internal module filenames and symbols were kept to preserve the
// shape and its green test suite; the branding throughout is now `tmct`.
//
// This entry re-exports the adapter primitives a library consumer needs. The
// clean chat/primitives split — pulling the movable grammar out of ask.mjs away
// from the core primitives it currently shares a file with — is deferred to
// ROADMAP.md.

// Chat surface (also reachable as the `./chat` subpath export).
export { runChat, COMMANDS, answerCount, renderStats } from "./chat.mjs";

// Grammar / NL-over-graph primitives.
export { ask, resolveObject } from "./ask.mjs";

// Graph traversal primitives.
export { relationKind, impactClosure } from "./codegraph.mjs";

// Tool dispatch (slash-commands and CLI tool calls route through here).
export { dispatchTool } from "./server.mjs";

// The single graph-load choke point — the adapter's data-provider seam.
export { fetchEntities } from "./source.mjs";
