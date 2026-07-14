// memory-ask-browser-entry.mjs — the esbuild entry for `tmct viz`'s embedded
// "Ask the graph" panel's memory-graph engine.
//
// Re-exports `factAnswer` (src/chat.mjs) and `createInMemoryStore`
// (src/memory/core.mjs), which lets the panel hand `factAnswer` the page's
// already-embedded payload with zero fs I/O. Called with `envelope: null,
// miss: true` to arm factAnswer's bare-question regex fallbacks directly,
// bypassing the structural-graph parse pipeline this panel has no use for.
import { factAnswer } from "./chat.mjs";
import { createInMemoryStore, normFactTerm } from "./memory/core.mjs";

// normFactTerm is re-exported too, for viz.mjs's client-side term normalization.
globalThis.tmctMemoryAsk = { factAnswer, createInMemoryStore, normFactTerm };
