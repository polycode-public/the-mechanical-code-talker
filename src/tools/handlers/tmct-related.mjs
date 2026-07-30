// tmct_related — a term's synonyms (skos:altLabel) and related concepts (skos:related),
// served from the conversational-memory graph's mgx:synonym / mgx:relatedTo / mgx:similarTo
// facts through the derived SKOS concept view (src/domain/skos-view.mjs). A term the store
// holds no relation facts for misses honestly — never a guessed neighbour.

import { ToolError } from "../../adapters/config.mjs";
import { relatedForTerm } from "../../domain/skos-view.mjs";
import { memoryFactRows } from "../memory-fallthrough.mjs";
import { requiredArg, toolResult } from "./kit.mjs";

export async function tmct_related(args, { config }) {
  const term = requiredArg(args, "term");
  const hit = relatedForTerm(await memoryFactRows(config), term);
  if (!hit) {
    throw new ToolError(
      `no synonym or related facts for "${term}" in the memory graph. ` +
        "This view answers where the store holds mgx:synonym / mgx:relatedTo facts (a corpus import seeds them).",
    );
  }
  const lines = [`${hit.prefLabel} [${hit.conceptId}]`];
  if (hit.synonyms.length) lines.push(`synonyms (skos:altLabel): ${hit.synonyms.join(", ")}`);
  if (hit.related.length) lines.push(`related (skos:related): ${hit.related.map((c) => c.prefLabel).join(", ")}`);
  lines.push("(from the memory graph's mgx:synonym / mgx:relatedTo / mgx:similarTo facts)");
  return toolResult({ content: lines.join("\n"), data: hit });
}

// The memory graph is this tool's only source — it answers with or without a
// code-map graph, so the shared code-graph load (which refuses an empty graph)
// must not gate it.
tmct_related.ownsGraphLoad = true;
