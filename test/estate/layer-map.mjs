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

  "ask.mjs": "domain",
  "codegraph.mjs": "domain",
  "syllogise.mjs": "domain",
  "planning.mjs": "domain",
  "domain.mjs": "domain",
  "prose.mjs": "domain",
  "ask-vocab.mjs": "domain",
  "answer-variants.mjs": "domain",
  "answer-variants.json": "domain",
  "paraphrase.mjs": "domain",
  "concept.mjs": "domain",
  "hash.mjs": "domain",
  "grammar/": "domain",
  "interpret/": "domain",
  "router/": "domain",
  "memory/trust.mjs": "domain",
  "memory/fold.mjs": "domain",
  "memory/bias.mjs": "domain",
  "memory/shacl.mjs": "domain",
  "completions/": "domain",

  "memory/core.mjs": "adapters",
  "memory/blocks.mjs": "adapters",
  "memory/prose-tokens.mjs": "adapters",
  "memory/inspect.mjs": "adapters",
  "providers/": "adapters",
  "source.mjs": "adapters",
  "source-slice.mjs": "adapters",
  "config.mjs": "adapters",
  "toml-config.mjs": "adapters",
  "graph-build.mjs": "adapters",
  "graph-merge.mjs": "adapters",
  "embed.mjs": "adapters",
  "wink-model.mjs": "adapters",
  "ask-nlp.mjs": "adapters",
  "prose-nlp.mjs": "adapters",
  "uuid.mjs": "adapters",
  "repository-interface.mjs": "adapters",
  "corpus/": "adapters",
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
