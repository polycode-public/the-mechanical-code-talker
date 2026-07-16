// memory-ask-browser-entry.mjs — the esbuild entry for the ledger page's
// chat dock (`tmct viz`, src/ledger-viz.mjs).
//
// Re-exports `factAnswer` (src/chat.mjs) and `createInMemoryStore`
// (src/adapters/memory/core.mjs), which lets the dock hand `factAnswer` the page's
// already-embedded payload with zero fs I/O. Called with `envelope: null,
// miss: true` to arm factAnswer's bare-question regex fallbacks directly,
// bypassing the structural-graph parse pipeline this dock has no use for.
import { factAnswer, factReadBack } from "./chat.mjs";
import { createInMemoryStore, normFactTerm } from "./adapters/memory/core.mjs";

// normFactTerm is re-exported too, for the page's client-side term normalization.
// factReadBack carries the taught-relation chases (grandfather-style questions)
// that factAnswer's own lanes don't reach.
globalThis.tmctMemoryAsk = { factAnswer, factReadBack, createInMemoryStore, normFactTerm };
