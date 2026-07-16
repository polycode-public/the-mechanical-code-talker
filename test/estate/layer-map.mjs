// Classifies every module under src/ into one of the five layers. Keys are
// paths relative to src/; a key ending in "/" claims the whole directory,
// with an exact file key winning over any directory prefix (memory/ splits
// between domain logic and the store backends this way).

export const LAYER_RANK = { adapters: 0, domain: 1, services: 2, tools: 3, surfaces: 4 };

export const LAYER_OF = {
  "tui/": "surfaces",
  "server-http.mjs": "surfaces",
  "memory-ask-browser-entry.mjs": "surfaces",
  "memory-ask-browser.bundle.js": "surfaces",

  "server.mjs": "tools",
  "schema-docs.mjs": "tools",
  "conformance.mjs": "tools",

  "chat.mjs": "services",
  "services/chat-session.mjs": "services",
  "sessions.mjs": "services",
  "init.mjs": "services",
  "import-file.mjs": "services",
  "extensions.mjs": "services",
  "cli-args.mjs": "services",
  "telemetry.mjs": "services",
  "ledger-viz.mjs": "services",
  "plan-viz.mjs": "services",
  "viz-theme.mjs": "services",
  "finish.mjs": "services",
  "sentences.mjs": "services",
  "index.mjs": "services",

  "domain/ask.mjs": "domain",
  "domain/codegraph.mjs": "domain",
  "domain/syllogise.mjs": "domain",
  "domain/planning.mjs": "domain",
  "domain/domain.mjs": "domain",
  "domain/prose.mjs": "domain",
  "domain/ask-vocab.mjs": "domain",
  "domain/answer-variants.mjs": "domain",
  "domain/answer-variants.json": "domain",
  "domain/paraphrase.mjs": "domain",
  "domain/concept.mjs": "domain",
  "domain/hash.mjs": "domain",
  "domain/grammar/": "domain",
  "domain/interpret/": "domain",
  "domain/router/": "domain",
  "domain/memory/trust.mjs": "domain",
  "domain/memory/fold.mjs": "domain",
  "domain/memory/bias.mjs": "domain",
  "domain/memory/shacl.mjs": "domain",
  "domain/completions/": "domain",

  "adapters/memory/core.mjs": "adapters",
  "adapters/memory/blocks.mjs": "adapters",
  "adapters/memory/prose-tokens.mjs": "adapters",
  "adapters/memory/inspect.mjs": "adapters",
  "adapters/providers/": "adapters",
  "adapters/source.mjs": "adapters",
  "adapters/source-slice.mjs": "adapters",
  "adapters/config.mjs": "adapters",
  "adapters/toml-config.mjs": "adapters",
  "adapters/graph-build.mjs": "adapters",
  "adapters/graph-merge.mjs": "adapters",
  "adapters/embed.mjs": "adapters",
  "adapters/wink-model.mjs": "adapters",
  "adapters/ask-nlp.mjs": "adapters",
  "adapters/prose-nlp.mjs": "adapters",
  "adapters/uuid.mjs": "adapters",
  "adapters/repository-interface.mjs": "adapters",
  "adapters/corpus/": "adapters",
};

/** Layer for a src/-relative path, or null when nothing claims it. */
export function layerOf(relPath) {
  if (LAYER_OF[relPath]) return LAYER_OF[relPath];
  let best = null;
  for (const key of Object.keys(LAYER_OF)) {
    if (key.endsWith("/") && relPath.startsWith(key) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  return best ? LAYER_OF[best] : null;
}
