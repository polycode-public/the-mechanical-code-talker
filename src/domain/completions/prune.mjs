// completions/prune.mjs — Stage 5 ("drop non-contributing elements"), at SENTENCE
// granularity: a sentence is kept if it's in a surviving group AND (feeds an asserted
// inference OR clears the per-group top-K/positive-score ranking cutoff); otherwise it's
// dropped with a recorded reason. A group that feeds an inference but has no ranking-
// qualified sentence still keeps its top-ranked sentence as an extractive anchor, so every
// asserted relation traces to a real sentence. Pure decision layer — computes nothing new
// about relevance, only reads what search/group/infer/rank already produced.

const DEFAULT_MAX_SENTENCES_PER_GROUP = 3;

/** Every group id referenced as either side of an asserted relation. */
function relatedGroupIdsOf(relations) {
  const set = new Set();
  for (const r of relations) {
    if (r && r.from) set.add(r.from);
    if (r && r.to) set.add(r.to);
  }
  return set;
}

/**
 * Stage 5 — pruning. Decides, per sentence, KEEP or DROP.
 *
 * @param {object} state
 * @param {Array<{id:string, text?:string}>} [state.hits] search.mjs's broadSearch() output
 * @param {Array<{id:string, memberIds:string[], label?:string}>} [state.groups] group.mjs's
 *   groupHits() output
 * @param {Array<{from:string, to:string, relation:string}>} [state.relations] infer.mjs's
 *   inferRelations() output
 * @param {Object<string, Array<{sentence:string, score:number, sourceBlockId:string}>>}
 *   [state.rankedByGroup] rank.mjs's rankSentences() output, keyed by group id
 * @param {object} [opts]
 * @param {number} [opts.maxSentencesPerGroup=3] the top-K-per-group ranking cutoff
 * @returns {{
 *   kept: Array<{sentence:string, score:number, sourceBlockId:string, groupId:string, groupLabel:string}>,
 *   dropped: Array<{item:object, reason:string}>
 * }} `kept` is ordered by (group id, rank order); `dropped` carries a human-readable `reason`.
 */
export function pruneCompletion(state = {}, { maxSentencesPerGroup = DEFAULT_MAX_SENTENCES_PER_GROUP } = {}) {
  const hits = Array.isArray(state.hits) ? state.hits : [];
  const groups = Array.isArray(state.groups) ? state.groups.filter((g) => g && g.id) : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];
  const rankedByGroup = state.rankedByGroup && typeof state.rankedByGroup === "object" ? state.rankedByGroup : {};

  const kept = [];
  const dropped = [];

  // "never grouped" — defensive: group.mjs's contract is every hit lands in some group.
  const groupedHitIds = new Set();
  for (const g of groups) for (const id of g.memberIds || []) groupedHitIds.add(id);
  for (const h of hits) {
    if (h && h.id != null && !groupedHitIds.has(h.id)) {
      dropped.push({ item: { kind: "hit", id: h.id, text: h.text ?? "" }, reason: "never grouped" });
    }
  }

  const relatedGroupIds = relatedGroupIdsOf(relations);

  const sortedGroups = groups.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const g of sortedGroups) {
    const ranked = Array.isArray(rankedByGroup[g.id]) ? rankedByGroup[g.id] : [];
    const groupFeedsInference = relatedGroupIds.has(g.id);

    const qualifying = [];
    const rest = [];
    ranked.forEach((s, i) => {
      const withinCutoff = i < maxSentencesPerGroup;
      const informative = s.score > 0;
      if (withinCutoff && informative) qualifying.push(s);
      else rest.push(s);
    });

    let anchor = null;
    if (!qualifying.length && groupFeedsInference && ranked.length) {
      // salvage: keep the group's top-ranked sentence as the extractive anchor.
      anchor = ranked[0];
      qualifying.push(anchor);
      const idx = rest.indexOf(anchor);
      if (idx >= 0) rest.splice(idx, 1);
    }

    for (const s of qualifying) {
      kept.push({ sentence: s.sentence, score: s.score, sourceBlockId: s.sourceBlockId, groupId: g.id, groupLabel: g.label });
    }

    for (const s of rest) {
      let reason;
      if (s === anchor) reason = null; // unreachable (anchor is always spliced into qualifying)
      else if (s.score <= 0 && groupFeedsInference) {
        reason = "zero-information score, and its group's asserted relation was already anchored by a different sentence";
      } else if (s.score <= 0) {
        reason = "zero-information score (no informative/query-focused tokens) and its group feeds no asserted inference";
      } else if (groupFeedsInference) {
        reason = `ranked below the per-group keep cutoff (top ${maxSentencesPerGroup}); its group feeds an asserted inference but this sentence was not the anchor`;
      } else {
        reason = "grouped but zero relations touched it and it wasn't top-ranked";
      }
      dropped.push({ item: { kind: "sentence", sourceBlockId: s.sourceBlockId, groupId: g.id, sentence: s.sentence }, reason });
    }
  }

  return { kept, dropped };
}
