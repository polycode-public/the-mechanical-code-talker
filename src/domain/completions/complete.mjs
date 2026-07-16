// completions/complete.mjs — the mechanical-text-generation pipeline: broadSearch ->
// groupHits -> rankSentences + inferRelations -> pruneCompletion -> assemble -> finish()'s
// grammar pass. Extractive only: output is the kept sentences, joined, never paraphrased.

import { broadSearch } from "./search.mjs";
import { groupHits } from "./group.mjs";
import { rankSentences } from "./rank.mjs";
import { inferRelations } from "./infer.mjs";
import { pruneCompletion } from "./prune.mjs";
import { loadMemory } from "../../adapters/memory/core.mjs";
import { finish, grammarRules } from "../../finish.mjs";

/** grammarRules() with sentence-capitalisation force-enabled (disabled in live chat only to
 *  protect single-answer lowercase-opener goldens, which don't apply to a multi-sentence
 *  completion). */
function completionGrammarRules() {
  return grammarRules().map((r) => (r.id === "sentence-capitalisation" ? { ...r, enabled: true } : r));
}

const DEFAULT_MAX_SENTENCES_PER_GROUP = 3; // see prune.mjs's own file header for the reasoning

/**
 * The full mechanical-text-generation pipeline, Stage 1 through Stage 6.
 *
 * @param {string} dir  repo root (broadSearch's block corpus + loadMemory's fact store)
 * @param {string} prompt  the broad prompt driving retrieval, grouping-focus ranking, and
 *   (by default) relation-anchored pruning
 * @param {object} [opts]
 * @param {number} [opts.blockK]  broadSearch's block k (default: search.mjs's own default)
 * @param {object|null} [opts.graphService=null]  optional Repository-Interface graph service,
 *   passed straight through to broadSearch (see search.mjs)
 * @param {number} [opts.graphLimit]  broadSearch's graph search() limit
 * @param {number} [opts.overlapMin]  groupHits' shared-token edge threshold
 * @param {object} [opts.memory]  an already-loaded memory/core.mjs loadMemory() payload;
 *   defaults to loadMemory(dir)
 * @param {string} [opts.query]  the query rankSentences()/pruning focus on; defaults to `prompt`;
 *   pass `null` for self-weighted (LexRank-style) ranking instead
 * @param {number} [opts.maxSentencesPerGroup=3]  prune.mjs's top-K-per-group cutoff
 * @param {object} [opts.graph]  optional loaded graph (src/domain/codegraph.mjs parseEntities() shape)
 *   handed to finish()'s maskSegments to protect known entity labels during the grammar pass
 * @returns {Promise<{
 *   text: string,
 *   sourceSpans: Array<{sourceBlockId:string, groupId:string, sentence:string}>,
 *   relations: Array<object>,
 *   dropped: Array<{item:object, reason:string}>,
 *   declined?: boolean,
 *   reason?: string,
 * }>}
 */
export async function generateCompletion(dir, prompt, opts = {}) {
  const {
    blockK, graphService = null, graphLimit, overlapMin,
    memory: memoryOpt, query = prompt, maxSentencesPerGroup = DEFAULT_MAX_SENTENCES_PER_GROUP,
    graph,
  } = opts;

  // Stage 1 — broad search
  const hits = await broadSearch(dir, prompt, { blockK, graphService, graphLimit });

  // Stage 2 — grouping
  const groups = groupHits(hits, { overlapMin });

  // Stage 3 — cross-group inference
  const memory = memoryOpt || await loadMemory(dir);
  const relations = groups.length >= 2 ? await inferRelations(groups, memory) : [];

  // Stage 4 — extractive sentence ranking, per group (query-focused unless the caller opted out)
  const rankedByGroup = {};
  for (const g of groups) rankedByGroup[g.id] = rankSentences(g, { query });

  // Stage 5 — pruning: decide keep/drop, with an itemized, auditable drop log
  const { kept, dropped } = pruneCompletion(
    { hits, groups, relations, rankedByGroup },
    { maxSentencesPerGroup },
  );

  if (!kept.length) {
    // Honest decline: nothing cleared the pruning bar for this prompt over this corpus — never
    // fabricate a completion to fill the gap.
    return { text: "", sourceSpans: [], relations, dropped, declined: true, reason: "no source span cleared the pruning bar for this prompt" };
  }

  // Assemble: kept sentences, in pruneCompletion's own order, joined by a single space.
  const rawText = kept.map((k) => k.sentence).join(" ");

  // Stage 6 — grammar/voice pass (reuses finish() verbatim; see completionGrammarRules() above).
  const finished = finish({ answer: rawText, via: "completion" }, { graph, rules: completionGrammarRules() });

  // sourceSpans traces every output sentence back to its block id + group id, from `kept`
  // (pre-grammar-pass) — stays index-aligned since finish() only mutates casing/punctuation.
  const sourceSpans = kept.map((k) => ({ sourceBlockId: k.sourceBlockId, groupId: k.groupId, sentence: k.sentence }));

  return { text: finished.answer, sourceSpans, relations, dropped };
}
