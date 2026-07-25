// chatbench/batch-judge.mjs — batch the residual judge calls per rubric family
// (PLAN lever 6). The delta-judging cache (lever 1) and tier promotion (lever 2)
// leave only the cases that actually changed; those still cost one judge call
// each. Cases sharing a rubric family (chatbench/rubrics.json) also share the
// same criteria and dimension set, so one prompt can carry several of them and
// ask for an array of verdicts — cutting the shared prompt overhead (context,
// criteria, instructions) from once-per-case to once-per-batch.
//
// This is the pure prompt/parse logic, exercised only under --dry-run and in the
// tests (no live judge call is ever made here). A batch verdict is still one
// 0|1|2 rubric per case — the same reviewed schema, just delivered together — so
// batching changes token cost, never what is scored.

import { groupByFamily } from "./rubrics.mjs";

/** Split rows into batches of at most `size`, grouped by rubric family so a
 *  batch is homogeneous (one criteria block covers all its cases). Returns an
 *  array of { family, rows } in a deterministic order (family name, then the
 *  id-sorted rows groupByFamily already produced). */
export function batchRows(rows, index, { size = 5 } = {}) {
  const byFamily = groupByFamily(rows, index);
  const batches = [];
  for (const family of [...byFamily.keys()].sort()) {
    const list = byFamily.get(family);
    for (let i = 0; i < list.length; i += size) {
      batches.push({ family, rows: list.slice(i, i + size) });
    }
  }
  return batches;
}

/** Render one case's block inside a batch prompt: its id, tags, and transcript.
 *  `renderTranscript` is injected (judge.renderTranscript) so this module keeps
 *  no dependency on the judge's transcript format. */
function caseBlock(row, i, renderTranscript) {
  return [
    `### case ${i + 1} — id: ${row.caseId}`,
    `tags: ${(row.tags || []).join(", ")}`,
    "transcript:",
    renderTranscript(row),
  ].join("\n");
}

/** Build a batch prompt over one family group: the shared rubric criteria and
 *  dimensions once, then every case's block, then the instruction to return a
 *  JSON array of one verdict per case, keyed by id. `rubric` is the family entry
 *  from rubrics.json (criteria + dimensions); `context` is the (shared) graph
 *  context every case in the batch scores against. */
export function buildBatchPrompt(batch, { rubric, context, renderTranscript }) {
  const dims = rubric?.dimensions ?? ["groundedness", "correctness", "honesty", "rephrase"];
  const criteria = (rubric?.criteria ?? []).map((c, i) => `${i + 1}. ${c}`).join("\n");
  const ids = batch.rows.map((r) => r.caseId);
  return [
    `You are grading ${batch.rows.length} tmct chat transcript(s) from the "${batch.family}" construction family.`,
    "",
    "Graph context (the facts tmct actually holds — every grounded claim must trace here):",
    context ?? "",
    "",
    `Score each case on these dimensions (0|1|2, or null when not applicable): ${dims.join(", ")}.`,
    "Rubric criteria for this family:",
    criteria,
    "",
    "The cases:",
    "",
    batch.rows.map((r, i) => caseBlock(r, i, renderTranscript)).join("\n\n"),
    "",
    `Return a JSON array of exactly ${batch.rows.length} objects, one per case, each: ` +
      `{ "caseId": <id>, "groundedness": 0|1|2|null, "correctness": 0|1|2|null, "honesty": 0|1|2|null, "rephrase": 0|1|2|null, "rationale": "<one sentence>" }. ` +
      `Use these ids in order: ${ids.join(", ")}.`,
  ].join("\n");
}

/** Parse a batched judge response (a JSON array, or the same as a string) into a
 *  map caseId -> verdict object. `validateOne(obj)` (judge.validateScores) lints
 *  each; an entry that fails validation is dropped from the map with its error in
 *  `errors`, never scored. Returns { verdicts, errors }. */
export function parseBatchOutput(raw, expectedIds, validateOne) {
  let arr = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch (e) { return { verdicts: new Map(), errors: [`batch output is not JSON: ${e.message}`] }; }
  }
  if (!Array.isArray(arr)) return { verdicts: new Map(), errors: ["batch output is not an array"] };
  const verdicts = new Map();
  const errors = [];
  const expected = new Set(expectedIds);
  for (const obj of arr) {
    const id = obj?.caseId;
    if (!expected.has(id)) { errors.push(`unexpected caseId in batch: ${JSON.stringify(id)}`); continue; }
    const bad = validateOne(obj);
    if (bad) { errors.push(`${id}: ${bad}`); continue; }
    verdicts.set(id, obj);
  }
  for (const id of expectedIds) if (!verdicts.has(id)) errors.push(`${id}: no verdict in batch response`);
  return { verdicts, errors };
}
