// memory-ask-browser-entry.mjs — the esbuild entry for the ledger page's
// chat dock (`tmct viz`, src/services/ledger-viz.mjs).
//
// The one COMMITTED browser bundle: `tmct viz` is a real CLI command run
// against a user's own local .tmct store, so this ships with the package. It
// deliberately carries the question lanes only (factAnswer/factReadBack) and
// not the full turn engine — see ledger-browser-entry.mjs's header for the
// contrast with the demo site's own 1.5MB dock.
//
// It publishes the SAME `globalThis.tmct` every other page does, through
// tmct-surface.mjs, which imports nothing — so this bundle gets the shared
// contract without the tool layer or the capability router coming with it.
// `tmct.turn` and `tmct.plan` are unwired here and say so: this dock asks
// questions, it does not hold a conversation or plan anything.
import { factAnswer, factReadBack } from "../../services/chat.mjs";
import { createInMemoryStore, normFactTerm } from "../../adapters/memory/core.mjs";
import { digestTermFromPayloadBrowser } from "./digest-client.mjs";
import { publishTmctSurface } from "./tmct-surface.mjs";

/** A question-only session over a payload the page already embeds — no fs I/O,
 *  no turn engine. Returns `{ memoryDir }`. */
export function createMemoryAskSession({ payload = null } = {}) {
  const memoryDir = createInMemoryStore();
  if (payload) memoryDir.payload = payload;
  return { memoryDir };
}

/**
 * One question, answered from the page's own embedded store. Runs the same
 * cascade `runAsk` runs — factAnswer first, then factReadBack, which is where
 * the taught-relation chases live ("who is the grandfather of ishmael") that
 * factAnswer's own lanes don't reach.
 *
 * Both are called with `envelope: null, miss: true`, which arms factAnswer's
 * bare-question fallbacks directly and skips the structural-graph parse
 * pipeline this dock has no use for.
 *
 * Returns `{ answer, data, miss }`. `data` is the reader's own result, so a
 * caller still sees the inferred `goal` line it computed on the way.
 */
export async function askMemory(request, options, session) {
  let fact = null;
  try { fact = await factAnswer(session.memoryDir, request, null, true, {}); } catch { fact = null; }
  if (!(fact && fact.text)) {
    try { fact = await factReadBack(session.memoryDir, request, null, true, null); } catch { fact = null; }
  }
  if (!(fact && fact.text)) return { answer: null, data: null, miss: true };
  return { answer: fact.text, data: fact, miss: false };
}

// `tmct.page` keeps the term normalizer the dock refocuses the ledger with,
// and the client-side digest reader — the narrative the demo ledger's live
// bundle produces, over the static structure table this page embeds.
// `fallback`, because the demo ledger page carries this bundle AND the full
// turn engine at once: this one answers where it is alone, and steps aside
// wherever the live dock is loaded, whichever order the two arrive in.
publishTmctSurface({
  open: createMemoryAskSession,
  ask: askMemory,
  page: { normFactTerm, digestTermFromPayloadBrowser },
  fallback: true,
});
