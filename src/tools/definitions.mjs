// The tool definitions — one entry per tool tmct serves, and the only place a
// tool's name, schema, purpose or example is written down. Everything else reads
// from here: the resident hot catalog and the dispatch set (server.mjs), the
// cold-tool catalog written into a repo (catalog.mjs), and the README's tool
// section (scripts/generate-tool-docs.mjs, checked by test/estate/tool-docs.test.mjs).
//
// Each definition carries:
//   name          the tool name callers invoke;
//   tier          "hot" (schema resident in the catalog, re-billed every turn) or
//                 "cold" (served by dispatchTool, reached via the CLI `cli <tool>` route);
//   summary       one plain-English line: what the tool answers. Documentation voice;
//   agentDescription  hot tools only — the description billed to a calling agent, written
//                 to steer it to one call instead of a Read/Grep loop;
//   inputSchema   JSON Schema for the arguments dispatchTool reads;
//   example       arguments for a worked invocation in the cold-tool catalog;
//   chat          chat-facing tools only — the canonical grammar the tool accepts,
//                 lexicon hints, and worked examples (see tmct_ask below).
//
// The lexicon hints are DERIVED from the parser's own relation table rather than
// restated here, so a verb the parser learns is a verb the documentation gains.

import { RELATIONS, WHERE_MARKERS } from "../domain/ask-vocab.mjs";

/** The relation kinds tmct_ask traverses, each with the opening verbs a question can
 *  use for it. Read from the parser's RELATIONS table — never a hand-kept copy. */
export const askLexicon = () =>
  Object.entries(RELATIONS).map(([kind, { verbs }]) => ({ kind, verbs: verbs.slice(0, 4) }));

const symbolArg = (description) => ({
  type: "object",
  required: ["symbol"],
  properties: { symbol: { type: "string", description } },
});

const moduleArg = (description) => ({
  type: "object",
  required: ["module"],
  properties: { module: { type: "string", description } },
});

const classArg = (description) => ({
  type: "object",
  required: ["class"],
  properties: { class: { type: "string", description } },
});

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "tmct_context",
    tier: "hot",
    summary:
      "A sized edit bundle for one symbol — exemplar source, sibling signatures, registration anchor and the insertion region, in one call.",
    // Lean resident schema (re-billed every turn): the minimum that still steers the agent to
    // ONE call → write, not Read.
    agentDescription:
      "START HERE to add/modify code: ONE call returns a sized edit bundle (exemplar source, sibling signatures, registration, insertion region) — then write directly, don't Read.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "Module path (e.g. path/to/module) or a sibling function/class name defined in it." },
        depth: { type: "string", enum: ["min", "auto", "full"], default: "auto", description: "auto (sized to the task) | min (leanest) | full (every section)." },
      },
    },
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_snippet",
    tier: "hot",
    summary:
      "The exact source of one function, class or Class.method — its line span only, plus a one-line in-repo call hint.",
    agentDescription:
      "EXACT source of one function/class/Class.method by name (its line span only) + a one-line in-repo call hint. Prefer over Read for a single symbol.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "function/class name, Class.method, or fn:<path>#name." },
      },
    },
    example: { symbol: "Truncator.chars" },
  },
  {
    name: "tmct_ask",
    tier: "hot",
    summary:
      "A structural question in plain English, answered from the graph in one call — no model, and a clean miss instead of a guess.",
    agentDescription:
      "Ask a structural question in plain English: \"which functions call X\", \"what uses X\", \"where is X defined\", \"when did X change\". One call, no model. A clean miss beats a guess.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "A free-text question, e.g. \"which functions explicitly couple to logging\"." },
      },
    },
    example: { query: "which modules import src/core/model.mjs" },
    chat: {
      // The canonical question shapes ask.mjs resolves to a traversal. Every example runs
      // against examples/mini-webapp, which is what the README's worked block invokes.
      exampleRepo: "examples/mini-webapp",
      grammar: [
        {
          form: "which <things> <relation-verb> <entity>",
          example: "which modules import src/core/model.mjs",
          answers: "the imports edge, read forwards",
        },
        {
          form: "what is <relation-verb-passive> <entity>",
          example: "what is imported by src/core/store.mjs",
          answers: "the same edge, read backwards — a passive is the opposite direction, not a synonym",
        },
        {
          form: "what <relation-verb> <entity>",
          example: "what uses src/lib/http.mjs",
          answers: "the uses union: imports plus calls",
        },
        {
          form: "where is <entity> <where-marker>",
          example: "where is saveStore defined",
          answers: "the definition's file and line span",
        },
        {
          form: "when did <entity> change",
          example: "when did src/core/store.mjs change",
          answers: "the commits that touched it, newest first",
        },
      ],
      whereMarkers: WHERE_MARKERS,
    },
  },
  {
    name: "tmct_describe",
    tier: "cold",
    summary: "Locate one symbol and list its typed edges (both directions) with provenance.",
    inputSchema: symbolArg("A module path, symbol name, or Class.method."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_signature",
    tier: "cold",
    summary: "One symbol's API surface (params, returns, raises/catches, flags, decorators, doc) without the body.",
    inputSchema: symbolArg("A function, method, or Class.method name."),
    example: { symbol: "Truncator.chars" },
  },
  {
    name: "tmct_impact",
    tier: "cold",
    summary: "Transitive reverse closure over imports/calls — what breaks if a module changes, by depth, with tests.",
    inputSchema: moduleArg("The module whose dependents you want."),
    example: { module: "django/utils/text.py" },
  },
  {
    name: "tmct_search",
    tier: "cold",
    summary: "Free-text/ranked lookup over the code-map to find the right module or symbol.",
    inputSchema: {
      type: "object",
      required: [],
      properties: {
        query: { type: "string", description: "Free text to rank against the code-map. Required unless kind narrows the search on its own." },
        kind: { type: "string", description: "Restrict to an entity class, e.g. function, class, module." },
        decorator: { type: "string", description: "Restrict to definitions carrying this decorator." },
        name: { type: "string", description: "Restrict to definitions whose name matches." },
      },
    },
    example: { query: "template filters", kind: "function" },
  },
  {
    name: "tmct_members",
    tier: "cold",
    summary: "A class's methods + attributes (file:line, decorators) in one slice.",
    inputSchema: classArg("The class whose members you want."),
    example: { class: "Truncator" },
  },
  {
    name: "tmct_subclasses",
    tier: "cold",
    summary: "A class's base classes plus the transitive set of classes that extend it.",
    inputSchema: classArg("The class to walk the inheritance edges of."),
    example: { class: "Field" },
  },
  {
    name: "tmct_architecture",
    tier: "cold",
    summary: "Package/module map + the most-imported hub modules (optionally scoped to a package).",
    inputSchema: {
      type: "object",
      required: [],
      properties: {
        package: { type: "string", description: "Scope the map to one package. Omit for the whole repository." },
      },
    },
    example: { package: "django/template" },
  },
  {
    name: "tmct_exports",
    tier: "cold",
    summary: "A module's public __all__ surface, each name resolved to the module that defines it.",
    inputSchema: moduleArg("The module whose public API surface you want."),
    example: { module: "django/db/models/__init__.py" },
  },
  {
    name: "tmct_tests_for",
    tier: "cold",
    summary: "The test modules covering a symbol or module, from the typed test edges.",
    inputSchema: symbolArg("The symbol or module to find covering tests for."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_untested",
    tier: "cold",
    summary: "Source modules with no covering test module — a coverage-gap view (no arguments).",
    inputSchema: { type: "object", required: [], properties: {} },
    example: {},
  },
  {
    name: "tmct_history",
    tier: "cold",
    summary: "Recent commits that touched a symbol's module (newest first).",
    inputSchema: symbolArg("The symbol whose module's history you want."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_file_history",
    tier: "cold",
    summary: "Commits that touched a symbol's module, each with author / date / subject.",
    inputSchema: symbolArg("The symbol whose module's history you want."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_method_history",
    tier: "cold",
    summary: "Commits that touched a specific method symbol (fine-grained), with author / date / subject.",
    inputSchema: symbolArg("A Class.method name."),
    example: { symbol: "Truncator.chars" },
  },
  {
    name: "tmct_class_history",
    tier: "cold",
    summary: "Commits that touched a specific class symbol (fine-grained), with author / date / subject.",
    inputSchema: symbolArg("A class name."),
    example: { symbol: "Truncator" },
  },
  {
    name: "tmct_callers",
    tier: "cold",
    summary: "Modules that call into a symbol's module (one hop).",
    inputSchema: symbolArg("The symbol whose callers you want."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_callees",
    tier: "cold",
    summary: "Modules a symbol's module calls into (one hop).",
    inputSchema: symbolArg("The symbol whose callees you want."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_calls",
    tier: "cold",
    summary: "The in-repo symbols a function calls (fn→fn), each with file:line.",
    inputSchema: symbolArg("The function whose in-repo call sites you want."),
    example: { symbol: "slugify" },
  },
  {
    name: "tmct_cochanges",
    tier: "cold",
    summary: "Modules that historically change in the same commit as a symbol's module (git co-change).",
    inputSchema: symbolArg("The symbol whose module's change-coupling you want."),
    example: { symbol: "django/utils/text.py" },
  },
  {
    name: "tmct_context_more",
    tier: "cold",
    summary: "The bundle sections a lean tmct_context omitted (siblings / tests / cochange / class members / re-exports).",
    inputSchema: symbolArg("The symbol a lean tmct_context bundle was built for."),
    example: { symbol: "django/utils/text.py" },
  },
]);

export const HOT_TOOLS = TOOL_DEFINITIONS.filter((t) => t.tier === "hot");
export const COLD_TOOLS = TOOL_DEFINITIONS.filter((t) => t.tier === "cold");

/** Every tool name dispatchTool serves. */
export const TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((t) => t.name));

export const toolByName = (name) => TOOL_DEFINITIONS.find((t) => t.name === name) || null;
