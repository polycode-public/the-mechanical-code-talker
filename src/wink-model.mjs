// wink-model.mjs — the ONE place tmct loads the wink-nlp engine + model.
//
// Two adapters sit on top of this leaf loader: ask-nlp.mjs (lemma/POS tier for the
// ask engine) and prose-nlp.mjs (lemma layer for the prose index). They used to
// each carry their own `createRequire(import.meta.url)` block — the same ~six lines
// twice, and both Node-only. That duplication is single-sourced here, and the
// Node-only limitation is lifted with a browser seam, WITHOUT eagerly bundling the
// ~1 MB model into anything.
//
// Why a registration seam instead of a static `import "wink-nlp"`:
//   - The whole architecture keeps the model OUT of the base/viewer bundle; a static
//     import would drag it in. `wink-eng-lite-web-model` is already the *browser*
//     build, so the model can run in the page — what was missing is a load path a
//     bundler can satisfy without a Node `require`. That path is `registerWinkModel`:
//     a browser/bundler entry imports wink with its own `import` and hands the pair
//     in ONCE, before any lemma/POS use. Node needs nothing — it falls back to
//     `createRequire`. This is the Phase-8 browser-mode unblocker the dependency
//     audit called for (a wiring fix; the model was always browser-capable).
//
// The loader stays SYNCHRONOUS (the adapters and their callers are sync): the
// browser host registers up front; Node resolves lazily via createRequire. Failure
// is cached as null — a checkout without the optional deps, or a page that never
// registered a model, simply runs adapter-less (lemma/POS tiers honestly off), it
// never throws.

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

/** Node fallback: resolve wink through the module system (never a guessed path),
 *  exactly as the two adapters did inline before. CJS deps, so `createRequire`. */
function nodeRequireWink() {
  const require = createRequire(import.meta.url);
  return {
    winkNLP: require("wink-nlp"),
    model: require("wink-eng-lite-web-model"),
  };
}

/** Convenience: the constructed `nlp` instance (`winkNLP(model)`) or null. Both
 *  adapters want exactly this. Not cached here — the adapters cache their own
 *  higher-level object; constructing `nlp` is cheap next to loading the model. */
export function winkInstance() {
  const loaded = loadWinkModel();
  if (!loaded) return null;
  try {
    return loaded.winkNLP(loaded.model);
  } catch {
    return null;
  }
}
