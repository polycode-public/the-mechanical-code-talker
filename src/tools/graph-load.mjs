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
    // session itself creates one as the conversation folds in). A caller with
    // no graphFile at all (no code domain configured, ever) reads the same:
    // `config?.graphFile` in the message below just names nothing.
    const e = new ToolError(
      `the graph at ${config?.graphFile} is empty — no entities to answer from yet ` +
        "(this repo starts with no graph; the chat session folds the conversation into one).",
    );
    // An empty CODE graph is not an empty world: a caller that can still answer
    // from the lexicon, the corpus or taught memory reads this flag and carries
    // on, rather than reporting the graph's emptiness to someone who never
    // asked a structural question.
    e.emptyGraph = true;
    throw e;
  }
  return graph;
}
