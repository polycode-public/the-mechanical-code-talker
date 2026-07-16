// wink-model.mjs — the ONE place tmct loads the wink-nlp engine + model, shared by
// ask-nlp.mjs and prose-nlp.mjs.
//
// A static `import "wink-nlp"` would drag the ~1 MB model into the base/viewer bundle.
// Instead, `registerWinkModel` lets a browser/bundler entry hand in an already-imported
// `{ winkNLP, model }` pair once; Node instead resolves lazily via `createRequire`.
//
// The loader stays synchronous. Failure is cached as null — a checkout without the
// optional deps, or a page that never registered a model, runs adapter-less rather
// than throwing.

import { createRequire } from "node:module";

let injected; // browser/bundler-supplied `() => ({ winkNLP, model })`, or undefined
let cached; // undefined = not tried yet; null = unavailable (tried once, honestly off)

/** Browser/bundler seam: register a factory returning `{ winkNLP, model }` (each the
 *  imported module) so the page's own bundler resolves wink instead of a Node
 *  `require`. Call once before any ask/prose lemma use. Resets the cache so a late
 *  registration still takes effect. */
export function registerWinkModel(factory) {
  injected = factory;
  cached = undefined;
  instance = undefined;
}

/** Load `{ winkNLP, model }` once, or null when wink isn't available. Prefers a
 *  registered browser factory; otherwise falls back to Node module resolution. */
export function loadWinkModel() {
  if (cached !== undefined) return cached;
  try {
    const pair = injected ? injected() : nodeRequireWink();
    cached = pair && pair.winkNLP && pair.model ? pair : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Node fallback: resolve wink through the module system (never a guessed path).
 *  CJS deps, so `createRequire`. */
function nodeRequireWink() {
  const require = createRequire(import.meta.url);
  return {
    winkNLP: require("wink-nlp"),
    model: require("wink-eng-lite-web-model"),
  };
}

let instance; // undefined = not built yet; null = construction failed once

/** Convenience: the constructed `nlp` instance (`winkNLP(model)`) or null.
 *  Cached: repeated `winkNLP(model)` construction accumulates module-level
 *  state inside the model package until V8 throws "Invalid string length",
 *  after which every later construction fails for the life of the process. */
export function winkInstance() {
  if (instance !== undefined) return instance;
  const loaded = loadWinkModel();
  if (!loaded) { instance = null; return null; }
  try {
    instance = loaded.winkNLP(loaded.model);
  } catch {
    instance = null;
  }
  return instance;
}
