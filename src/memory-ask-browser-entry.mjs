// memory-ask-browser-entry.mjs — the esbuild entry for `tmct viz`'s embedded
// "Ask the graph" panel's MEMORY-graph engine (PLAN_VIZ_MEMORY.md Bug 1 fix).
//
// Bug 1: the panel bundled ONLY ask.mjs — tmct's code-graph query engine
// ("which modules import X"), which has no concept of Facts/corpus data at
// all, so a memory-graph question like "what is a dog" always missed even
// though the page's own embedded payload had the answer. This is the SECOND,
// narrow browser entry point src/ask-browser-entry.mjs's own doc comment
// anticipates: re-exports just `factAnswer` (src/chat.mjs) — tmct's REAL
// memory-graph answer engine, the same one `npm run chat` uses — plus
// `createInMemoryStore` (src/memory/core.mjs), which is how the panel hands
// `factAnswer` the page's already-embedded PAYLOAD with ZERO fs I/O: a
// Backend-B handle's `loadMemory` branch returns `handle.payload` directly, no
// bundle-time module shimming needed (see factAnswer's own doc comment,
// src/chat.mjs, for the full reasoning — a simpler, more robust mechanism than
// intercepting loadMemory at bundle time, since it reuses machinery the
// codebase already ships and tests, rather than a new esbuild-only code path
// that could drift from the real one).
//
// `factAnswer` is called with `envelope: null, miss: true` — the exact,
// already-documented "no envelope available" bootstrap path (chat.mjs's own
// comments: "the FIRST turn of a graph-less session... leaves `envelope` null
// for the rest of THIS turn's processing" — a real, tested code path, not a
// hack) — which arms factAnswer's own bare-question regex fallbacks
// (BARE_WHATIS_RE and friends) to parse the query directly, with no
// dependency on the much larger structural-graph parse pipeline
// (dispatchTool/loadGraph, server.mjs) that pipeline needs a real --repo code
// index for and this panel has no use for.
import { factAnswer } from "./chat.mjs";
import { createInMemoryStore, normFactTerm } from "./memory/core.mjs";

// normFactTerm is re-exported too — viz.mjs's client-side "focus follows the
// memory-engine's answer" heuristic (guessTermIdFromQuery) needs the SAME
// term normalization the CLI's own `--term` seed flag and factAnswer's own
// subject/object matching use, never a second hand-rolled copy.
globalThis.tmctMemoryAsk = { factAnswer, createInMemoryStore, normFactTerm };
