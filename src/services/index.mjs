// @polycode-projects/the-mechanical-code-talker (tmct) — library entry point.
//
// This entry re-exports the adapter primitives a library consumer needs. The
// movable conversational grammar lives in src/domain/interpret/ (normalization
// pre-pass, the registered parsing strategies, the merge rule), while
// ask.mjs keeps the core primitives (resolveObject, traverse, render) and
// the ask() orchestration.

// Chat surface.
// createSession is the library's session sink — the same focus/last/planState
// threading and memory-backend seam every shell shares; runTurn is the pure
// single-turn engine underneath it.
export { runChat, createSession, runTurn, COMMANDS, answerCount, renderStats } from "./chat.mjs";

// Grammar / NL-over-graph primitives.
export { ask, resolveObject } from "../domain/ask.mjs";

// The interpretation pipeline: normalize once, run every
// registered strategy (grammar, keyword-spot, …) over the text, merge same-class
// results, surround distinct-class results — no graph access; pair it with ask()
// or the primitives to answer. `interpret(text, ctx)` returns the full record
// ({raw, normalized, normalizationChanged, results, parsed, class, alternates}).
export { interpret } from "../domain/interpret/pipeline.mjs";

// Composition: the library entry wires the domain parser's default lemma/POS
// adapter and the construction-grammar banks (lazy loader), same as the chat
// and tool surfaces do for themselves.
import { setDefaultNlpAdapter } from "../domain/interpret/nlp-registry.mjs";
import { setConstructionBanks } from "../domain/interpret/strategies/constructions.mjs";
import { nlpAdapter } from "../adapters/ask-nlp.mjs";
import { readConstructionFiles } from "../adapters/corpus/construction-banks.mjs";
setDefaultNlpAdapter(nlpAdapter);
setConstructionBanks(readConstructionFiles);

// Graph traversal primitives.
export { relationKind, impactClosure } from "../domain/codegraph.mjs";

// Graph-service construction for a provider-supplied code graph.
export { createGraphService } from "../adapters/providers/graph-service.mjs";

// Tool dispatch (slash-commands and CLI tool calls route through here).
export { dispatchTool, dispatchToolStructured } from "../tools/server.mjs";

// Conversational memory — tmct's OWN OWL-labelled graph under
// .tmct/memory/, distinct from any provider-supplied code graph.
export { loadMemory, appendUtterance, appendFact } from "../adapters/memory/core.mjs";
export { retrieveBlocks, saveBlock, rankBlocks } from "../adapters/memory/blocks.mjs";
export { foldSessionLogs } from "./fold.mjs";

// The single graph-load choke point — the adapter's data-provider seam
// (docs/adapter-contract.md): registerProvider() plugs a producer in;
// fetchEntities() is the one read path.
export { fetchEntities, registerProvider } from "../adapters/source.mjs";

// `tmct init` onboarding.
// init.mjs and toml-config.mjs each export a same-named `CONFIG_FILE`
// constant ("tmct.toml") — aliased here so both can ride the one `.` entry
// point without colliding.
export { initRepo, defaultConfig, renderTomlConfig, PERSONA_PRESETS, CONFIG_FILE as INIT_CONFIG_FILE } from "./init.mjs";

// tmct.toml loading.
export { CONFIG_FILE as TOML_CONFIG_FILE } from "../adapters/toml-config.mjs";

// The "detailed answer" completions pipeline (also reachable as the
// `./generateCompletion` and `./createCompletionsGraphAdapter` subpath exports).
export { generateCompletion, createCompletionsGraphAdapter } from "./completions.mjs";
