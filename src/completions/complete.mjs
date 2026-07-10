// completions/complete.mjs — the full PLAN_COMPLETIONS.md pipeline, wired end to end:
// broadSearch (Stage 1) -> groupHits (Stage 2) -> rankSentences per group + inferRelations
// across groups (Stage 3+4) -> pruneCompletion's keep/drop (Stage 5) -> assemble the kept
// sentences into prose -> finish()'s grammar/voice pass (Stage 6). §4's staging table, row 3:
// "Stage 5+6 — pruning + grammar/voice pass wired end to end... Stage 6 reuses finish.mjs
// directly... Exit criterion: A full end-to-end completion reads as one consistent voice and
// every sentence traces to a source span."
//
// Extractive, by construction (PLAN_COMPLETIONS.md §3's honest ceiling): the assembled text is
// the KEPT sentences, in order, joined by a single space — never paraphrased, never reordered
// beyond what pruning's own group/rank order already decided, never smoothed over a genuine
// disjointedness in the source material. Stage 6 fixes CAPITALISATION and PUNCTUATION at every
// sentence boundary (this dispatch's own generalisation of src/finish.mjs's ruleCapitalise/
// ruleTerminal); it does not invent, reorder, or merge any sentence's WORDS. Where the source
// material simply doesn't chain into a fluent read, the output reads disjointedly and stays
// honest about it — that is the plan's own accepted, documented limit, not a bug this module
// tries to paper over.
//
// Traceability: `sourceSpans` is built directly from pruneCompletion()'s own `kept` list (which
// already carries sourceBlockId + groupId per sentence) BEFORE the grammar pass runs, and the
// grammar pass never reorders, drops, or merges sentences (only mutates casing/punctuation of
// prose text) — so sourceSpans stays index-aligned with "one entry per output sentence" even
// though the FINAL text is produced by finish(), not directly from `kept`. `relations` is
// infer.mjs's own output, untouched by pruning (relations are never pruned, only the sentences
// that anchor them are decided) — every relation still carries its own `licensingTest`/
// `evidence` per infer.mjs's contract.
//
// Determinism: every stage this module chains is already deterministic (broadSearch, groupHits,
// rankSentences, inferRelations, pruneCompletion, finish() are all pure/deterministic functions
// over their inputs); this module adds no randomness of its own. See
// test/completions-complete.test.mjs's own double-run diff.

import { broadSearch } from "./search.mjs";
import { groupHits } from "./group.mjs";
import { rankSentences } from "./rank.mjs";
import { inferRelations } from "./infer.mjs";
import { pruneCompletion } from "./prune.mjs";
import { loadMemory } from "../memory/core.mjs";
import { finish, grammarRules } from "../finish.mjs";

/** grammarRules() with sentence-capitalisation FORCE-ENABLED, everything else exactly as the
 *  live table has it. sentence-capitalisation stays PARKED (enabled=false) in the live chat
 *  table (grammar-rules.toml's own cycle-006 note: it regresses case-sensitive single-answer
 *  goldens pinning lowercase openers) — that is a CHAT-voice decision, not a limitation of the
 *  rule itself. A genuinely multi-sentence extractive completion has no such single-opener
 *  voice to protect and NEEDS every internal sentence boundary capitalised to read as one
 *  consistent voice (this pipeline's own exit criterion) — so this module's own Stage 6 call
 *  overrides just that one rule's enabled flag, via finish()'s ctx.rules seam, without touching
 *  the cached global table or any other caller's behaviour. */
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
 * @param {object} [opts.memory]  an already-loaded memory/core.mjs loadMemory() payload; when
 *   omitted, this module loads it itself via loadMemory(dir) (a fresh/empty memory is a
 *   perfectly valid, honest input — inferRelations() simply asserts nothing over it)
 * @param {string} [opts.query]  the query rankSentences()/pruning focus on; defaults to `prompt`
 *   itself (query-focused summarization, PLAN_COMPLETIONS.md §1.4's own literature framing) —
 *   pass `null` explicitly to fall back to self-weighted (LexRank-style) ranking instead
 * @param {number} [opts.maxSentencesPerGroup=3]  prune.mjs's top-K-per-group cutoff
 * @param {object} [opts.graph]  optional loaded graph (src/codegraph.mjs parseEntities() shape)
 *   handed to finish()'s maskSegments so known entity labels inside the assembled text are
 *   protected during the grammar pass — the same ctx.graph existing finish() call sites pass
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

  // Stage 3 — cross-group inference (needs a loaded memory; a fresh/empty one is honest and
  // simply asserts nothing, never fabricates something to compensate)
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
    // Honest decline (PLAN_COMPLETIONS.md §3): nothing cleared the pruning bar for this prompt
    // over this corpus — never fabricate a completion to fill the gap.
    return { text: "", sourceSpans: [], relations, dropped, declined: true, reason: "no source span cleared the pruning bar for this prompt" };
  }

  // Assemble: kept sentences, in pruneCompletion's own (group-id, rank-order) order, joined by a
  // single space — purely extractive, no reordering/paraphrasing beyond that (§3's honest
  // ceiling; see file header).
  const rawText = kept.map((k) => k.sentence).join(" ");

  // Stage 6 — grammar/voice pass. Reuses finish() verbatim (its maskSegments() masker still
  // protects any known entity/path/number/receipt/provenance span WITHIN the assembled text,
  // exactly as it does for a single-answer composed answer); only the rule table differs
  // (sentence-capitalisation force-enabled — see completionGrammarRules() above).
  const finished = finish({ answer: rawText, via: "completion" }, { graph, rules: completionGrammarRules() });

  // sourceSpans traces every OUTPUT sentence back to its block id + group id — built from
  // `kept` (pre-grammar-pass), which stays index-aligned with the final text because finish()'s
  // grammar rules only mutate casing/punctuation of prose, never reorder/drop/merge sentences.
  const sourceSpans = kept.map((k) => ({ sourceBlockId: k.sourceBlockId, groupId: k.groupId, sentence: k.sentence }));

  return { text: finished.answer, sourceSpans, relations, dropped };
}
