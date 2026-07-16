// The one graph load the tool layer does: config -> source.fetchEntities -> parseEntities.
// Re-exported by server.mjs so chat.mjs's compare lane loads the SAME graph the tools
// themselves load, with no second loading path.

import { ToolError } from "../adapters/config.mjs";
import { parseEntities } from "../domain/codegraph.mjs";

export async function loadGraph(config, source) {
  const payload = await source.fetchEntities(config);
  const graph = parseEntities(payload);
  if (!graph.individuals.length) {
    // Honest miss, never a stack: a fresh repo simply has no graph yet (the chat
    // session itself creates one as the conversation folds in).
    throw new ToolError(
      `the graph at ${config.graphFile} is empty — no entities to answer from yet ` +
        "(this repo starts with no graph; the chat session folds the conversation into one).",
    );
  }
  return graph;
}
