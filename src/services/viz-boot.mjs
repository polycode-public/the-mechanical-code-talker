// viz-boot.mjs — the shared wink-nlp vendor loader six-plus-one viz modules
// each hand-rolled with the same bounded-race shape (`research-viz.mjs`,
// `ingest-viz.mjs`, `plan-viz.mjs`, `ledger-viz.mjs`, `sprite-catalog-viz.mjs`,
// `chat-page-viz.mjs`, each commenting that it uses "the same pattern" as a
// sibling; `code-explorer-viz.mjs` is a seventh with no timeout at all).
// `import()` can fail in a way that neither resolves nor rejects (a stalled
// network request, an old cached asset), so every copy already raced it
// against a timeout rather than awaiting it unbounded.
//
// This converges the seven onto ONE failure behaviour: a fixed timer from
// the call, memoized so a second boot path awaiting the same load (every
// caller here has at least two — an eager fire-and-forget at page load, then
// an `await` inside its own session-ensuring function) resolves immediately
// rather than racing the import a second time. That is the shape five of the
// seven already shared; `chat-page-viz.mjs`'s own richer variant measures the
// timeout from the last downloaded byte instead of the call, so a slow-but-
// progressing multi-megabyte download is never abandoned mid-stream — a real
// improvement this shared version does not attempt to fold in, so that page
// keeps its own version rather than losing the nuance to this one.
//
// Self-contained (no closure over page state beyond its own options),
// `.toString()`-splice safe: `importVendor`'s default is a literal dynamic
// `import()` expression, so when this factory's returned function is spliced
// into a page's own inline `<script>` via `Function.prototype.toString()`,
// the import path resolves relative to that page, exactly like every one of
// the seven originals.

/**
 * `loadWinkVendor({ timeoutMs, register, importVendor })` returns a memoized
 * loader function — call it with no arguments, as many times as needed (an
 * eager fire at boot, then an awaited call before the first session needs
 * it); every call after the first resolves the SAME promise rather than
 * importing again.
 *
 * `register(factory)` is called once, only on a successful load, with a
 * factory returning `{ winkNLP, model }` — the shape every one of the seven
 * originals hands to their own page's `registerWinkModel`. `importVendor`
 * (default: `() => import("./vendor/wink.js")`) is the dynamic import call
 * itself, injectable so a test can supply a resolved/rejected/never-settling
 * promise without a real vendor asset on disk.
 *
 * The loader never throws: a timeout or a load failure logs a warning and
 * resolves `"unavailable"` — the lemma/POS tier is optional everywhere it is
 * used, so a caller that awaits this is never blocked by its own boot.
 * Resolves `"loaded"` on success.
 */
export function loadWinkVendor({
  timeoutMs = 8000,
  register,
  importVendor = () => import("./vendor/wink.js"),
} = {}) {
  let ready = null;
  return function loadWinkVendorOnce() {
    if (ready) return ready;
    ready = (async () => {
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("wink vendor asset load timed out")), timeoutMs);
      });
      try {
        const mod = await Promise.race([importVendor(), timeout]);
        if (register) register(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
        return "loaded";
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("tmct: the wink vendor asset failed to load, continuing without the lemma/POS tier", err);
        return "unavailable";
      }
    })();
    return ready;
  };
}
