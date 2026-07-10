// completions/prune.mjs — Stage 5 ("drop non-contributing elements") of PLAN_COMPLETIONS.md's
// six-stage mechanical-text-generation pipeline. §4's staging table (row 3, "Stage 5+6"): "any
// retrieved span that ends up in no surviving group, feeds no asserted inference, and is not
// selected by Stage 4's ranking gets cut, explicitly, with the drop recorded (not silently
// discarded) so the pipeline's own working set is auditable end to end" (§1.5).
//
// Reading the plan's own sentence precisely: the three conditions are joined by AND, so a span
// is dropped only when ALL three hold — equivalently, a span is KEPT when ANY of the three is
// false: it IS in a surviving group, OR it DOES feed an asserted inference, OR it IS selected by
// ranking. This module implements that OR exactly, at SENTENCE granularity (rank.mjs's own
// ranking unit — the thing that actually composes into the assembled prose), with a "hit never
// grouped" defensive check underneath it for the coarser block/hit granularity search.mjs hands
// group.mjs (group.mjs's own contract is that every hit lands in SOME group, so this branch is
// a guard against that invariant breaking silently, not an expected live path today).
//
// Inputs are the pipeline's own already-computed intermediate state — this module computes
// NOTHING new about relevance; it only DECIDES keep/drop from what search.mjs/group.mjs/
// infer.mjs/rank.mjs already produced, and records why. `rankedByGroup` is deliberately an
// INPUT (rank.mjs's own rankSentences() output per group), not recomputed here — pruning is a
// pure decision layer over ranking's output, not a second ranker.
//
// THRESHOLD + REASONING (the plan's own "your call on a sensible cutoff, document your
// reasoning"):
//   - top-K per group (default 3, `opts.maxSentencesPerGroup`): rankSentences() is already
//     best-first per group; keeping only the top K bounds the assembled completion's size in a
//     VISIBLE, documented, override-able way. An unbounded "keep everything with any positive
//     score" would make the completion grow without limit as a group's member count grows —
//     that is itself a silent, unaudited cap in the opposite direction (nothing stops it from
//     ballooning to the size of the whole retrieved corpus for a broad-enough prompt); a small
//     explicit K is the "no silent caps" discipline applied honestly — the cap is visible in the
//     signature, in this comment, and in every drop log entry it produces.
//   - positive score (`score > 0`): rankSentences()'s own scoring is 0 exactly when a sentence
//     shares no informative (or, under query-focus, no query-overlapping) token with anything —
//     rank.mjs's own "never a guessed match" discipline. A zero-information sentence contributes
//     nothing to the completion's content by rankSentences()'s own definition, so it never
//     qualifies on ranking grounds alone, however small K is set.
//   - relation-anchor salvage: a group that feeds an asserted cross-group inference (infer.mjs)
//     but produces ZERO ranking-qualified sentences (every one of its sentences is either
//     outside top-K or zero-scored) is not silenced outright — its single top-ranked sentence is
//     kept as the group's extractive anchor, so a cross-group claim this pipeline actually
//     ASSERTS (with cited licensing evidence) always has at least one real, traceable sentence
//     behind it in the assembled text. This is the concrete realisation of the plan's OR: the
//     three drop conditions must ALL hold, and "feeds no asserted inference" is one of them.
//
// Determinism: no randomness anywhere. Groups are processed in a fixed (id-sorted) order;
// rankedByGroup's own sentence order (rank.mjs's own deterministic tiebreak) is preserved
// exactly; the output kept/dropped lists are therefore fully deterministic given deterministic
// inputs — see test/completions-prune.test.mjs's own double-run diff.

const DEFAULT_MAX_SENTENCES_PER_GROUP = 3;

/** Every group id referenced as either side of an asserted relation (infer.mjs's inferRelations()
 *  output) — the "feeds an asserted inference" test, at group granularity (the granularity
 *  relations are actually asserted at). */
function relatedGroupIdsOf(relations) {
  const set = new Set();
  for (const r of relations) {
    if (r && r.from) set.add(r.from);
    if (r && r.to) set.add(r.to);
  }
  return set;
}

/**
 * Stage 5 — pruning. Decides, per sentence, KEEP or DROP, from the pipeline's own already-
 * computed intermediate state — never recomputing relevance itself.
 *
 * @param {object} state
 * @param {Array<{id:string, text?:string}>} [state.hits] search.mjs's broadSearch() output (used
 *   only for the defensive "never grouped" check below — group.mjs's own contract is that this
 *   branch should never actually fire today).
 * @param {Array<{id:string, memberIds:string[], label?:string}>} [state.groups] group.mjs's
 *   groupHits() output.
 * @param {Array<{from:string, to:string, relation:string}>} [state.relations] infer.mjs's
 *   inferRelations() output.
 * @param {Object<string, Array<{sentence:string, score:number, sourceBlockId:string}>>}
 *   [state.rankedByGroup] rank.mjs's rankSentences() output, ONE ENTRY PER GROUP, keyed by
 *   group id — an INPUT to this module, not recomputed here (see file header).
 * @param {object} [opts]
 * @param {number} [opts.maxSentencesPerGroup=3] the top-K-per-group ranking cutoff (see file
 *   header for the reasoning behind the default).
 * @returns {{
 *   kept: Array<{sentence:string, score:number, sourceBlockId:string, groupId:string, groupLabel:string}>,
 *   dropped: Array<{item:object, reason:string}>
 * }} `kept` is sentence-granular, ordered by (group id, rank order within the group) — a stable,
 *   deterministic order the caller can assemble directly. `dropped` is itemized, one entry per
 *   dropped hit/sentence, each carrying a human-readable `reason` (never a silent discard —
 *   PLAN_COMPLETIONS.md §1.5/§2's own auditability bar).
 */
export function pruneCompletion(state = {}, { maxSentencesPerGroup = DEFAULT_MAX_SENTENCES_PER_GROUP } = {}) {
  const hits = Array.isArray(state.hits) ? state.hits : [];
  const groups = Array.isArray(state.groups) ? state.groups.filter((g) => g && g.id) : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];
  const rankedByGroup = state.rankedByGroup && typeof state.rankedByGroup === "object" ? state.rankedByGroup : {};

  const kept = [];
  const dropped = [];

  // "never grouped" — defensive: every hit should land in SOME group (group.mjs never drops a
  // hit), so this guards the invariant explicitly rather than silently assuming it holds.
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
      // salvage: the group's own single top-ranked sentence, kept as the extractive anchor for
      // its asserted cross-group relation even though it didn't clear the ranking cutoff alone.
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
