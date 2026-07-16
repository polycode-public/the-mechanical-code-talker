// interpret/nlp-registry.mjs — the default lemma/POS adapter slot. The domain
// parser never imports the wink adapter; a composition point (chat.mjs,
// server.mjs, index.mjs) registers ask-nlp.mjs's factory here at load time.
// Nothing registered (the browser bundle, a pure-domain unit test) means
// defaultNlp() is null — the same adapter-less tier the old
// `typeof nlpAdapter === "function"` guard selected.

let defaultAdapterFactory = null;

/** Register the process-default adapter FACTORY (ask-nlp.mjs's nlpAdapter —
 *  a function returning the { lemma, isStopWord, posTags } adapter or null). */
export function setDefaultNlpAdapter(factory) {
  defaultAdapterFactory = factory;
}

/** The default lemma/POS adapter instance, or null when no factory is
 *  registered (or the registered one reports the deps unavailable). */
export function defaultNlp() {
  return typeof defaultAdapterFactory === "function" ? defaultAdapterFactory() : null;
}
