// @polycode-projects/mct — library entry point.
//
// mct is a whole-package lift of the seonix chat surface (v0.1.0). Internal
// module filenames and symbols are kept verbatim from seonix to preserve the
// "same shape" and its green test suite; the user-facing branding is `mct`.
//
// This entry re-exports the adapter primitives a future seonix→mct adapter (and
// any other library consumer) needs. The clean chat/primitives split — pulling
// the movable grammar out of ask.mjs away from the core primitives it currently
// shares a file with — is deferred to ROADMAP.md.

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
