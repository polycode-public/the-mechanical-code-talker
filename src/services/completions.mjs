// completions.mjs — the composition root for src/domain/completions/'s pipeline. The stages
// there are pure: they read the memory store, the block store, the graph service and the
// prose finisher through an explicit `store`/`finisher` handle, and import none of them. This
// file builds the real handles from the adapters and re-exports both entry points with the
// signatures package.json's `./generateCompletion` and `./createCompletionsGraphAdapter`
// subpaths publish, so an external caller never passes a store of its own.

import {
  buildNeighbours, degreeOf, OVERLAP_MIN, rankBlocks, retrieveBlocks, tokenizeBlock,
} from "../adapters/memory/blocks.mjs";
import { loadMemory, normFactTerm, readFactRows, resolveRelationChase } from "../adapters/memory/core.mjs";
import { createGraphService } from "../adapters/providers/graph-service.mjs";
import { finish, grammarRules } from "./finish.mjs";
import { generateCompletion as generateCompletionOver } from "../domain/completions/complete.mjs";
import { createCompletionsGraphAdapter as createCompletionsGraphAdapterOver } from "../domain/completions/graph-adapter.mjs";

/** Every store handle the six stages read through, in one bag: the memory store's fact
 *  readers, the block store's retrieval/clustering/ranking helpers, and the graph service
 *  factory graph-adapter.mjs wraps. */
export const COMPLETIONS_STORE = {
  loadMemory,
  readFactRows,
  normFactTerm,
  resolveRelationChase,
  retrieveBlocks,
  buildNeighbours,
  rankBlocks,
  degreeOf,
  tokenizeBlock,
  OVERLAP_MIN,
  createGraphService,
};

/** finish.mjs reads its grammar rules from TOML on disk, so it stays in services and reaches
 *  the pipeline's Stage 6 through this handle. */
export const COMPLETIONS_FINISHER = { finish, grammarRules };

/**
 * The full mechanical-text-generation pipeline over the real store. Same signature and
 * behaviour as src/domain/completions/complete.mjs's generateCompletion(); see its docblock
 * for the options. A caller may still override any handle through `opts.store`/`opts.finisher`.
 */
export function generateCompletion(dir, prompt, opts = {}) {
  return generateCompletionOver(dir, prompt, {
    store: COMPLETIONS_STORE, finisher: COMPLETIONS_FINISHER, ...opts,
  });
}

/**
 * A graphService-shaped adapter for broadSearch() over the real store. Same signature and
 * behaviour as src/domain/completions/graph-adapter.mjs's createCompletionsGraphAdapter().
 */
export function createCompletionsGraphAdapter(graph, memory = null) {
  return createCompletionsGraphAdapterOver(graph, memory, { store: COMPLETIONS_STORE });
}
