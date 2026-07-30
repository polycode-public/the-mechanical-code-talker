// engine-surface.mjs — the standard `ask` and `plan` routes a browser page
// wires into publishTmctSurface (tmct-surface.mjs).
//
// Both run the SAME machinery the CLI runs, over the session's own in-memory
// state rather than a repo on disk: `graphAsk` dispatches `tmct_ask` through
// the tool layer and hands back the structured envelope beside the prose
// (dispatchToolStructured's `{ content, data }`); `enginePlan` builds the
// capability planner's context from whatever the session holds and runs one
// request through it.
//
// Kept out of tmct-surface.mjs on purpose. That module is pure wiring and
// imports nothing, so memory-ask-browser-entry.mjs — the one bundle that is
// committed and published, and is deliberately small — can publish the same
// `globalThis.tmct` without pulling the tool layer and the router into its
// bundle.
import { dispatchToolStructured } from "../../tools/server.mjs";
import { capabilityPlanDeps, noCodeGraph } from "../../services/chat.mjs";

/**
 * One plain-English question, answered against the graph this session holds,
 * through the same `tmct_ask` tool the CLI dispatches. Returns
 * `{ answer, data, miss }` — `data` is ask()'s own envelope (the parse, the
 * matches it found, the traversal it walked), which is what a panel renders
 * rows from and what makes an answer auditable.
 *
 * A session whose graph is empty answers with an honest miss. That is the real
 * state of a memory-only page: its rows are facts in a store, and ask() reads
 * a graph. spider-fly is the page that closed that gap for its own world, by
 * projecting its live board into a graph (worldRelationGraphPayload) before
 * every turn — the same route is open to any page whose rows have a shape
 * worth asking over.
 */
export async function graphAsk(request, options, session) {
  const { content, data } = await dispatchToolStructured("tmct_ask", { query: request }, {
    graph: session.graph,
    memoryBackend: session.memoryDir,
  });
  return { answer: content, data, miss: Boolean(data?.miss) };
}

/**
 * One compound or maintenance-goal request, planned and executed over whatever
 * this session holds — the same capability router `/plan` reaches, with the
 * same memory-only mode a page with no code graph needs (a code-graph
 * capability there refuses by naming the graph it hasn't got).
 *
 * Returns the planner's own result: `{ refused, why, driver, calls, composed,
 * observed }`. No prose is composed here — a page that wants the written
 * answer asks for it in words through `tmct.turn("/plan …")`, which is the
 * same split `dispatchTool` and `dispatchToolStructured` already draw.
 */
export async function enginePlan(request, options, session) {
  const graph = session.graph && !noCodeGraph(session.graph) ? session.graph : null;
  const memoryDir = session.memoryDir ?? null;
  if (!graph && !memoryDir) {
    return {
      refused: true,
      why: "nothing to plan over — this session holds neither a code graph nor a memory store",
      driver: null, calls: [], composed: null, observed: null,
    };
  }
  const { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } =
    await import("../../domain/router/drive.mjs");
  const ctx = await buildCapabilityPlanCtx({
    ...capabilityPlanDeps(), config: null, source: null, graph, memoryDir,
  });
  try {
    const result = await runCapabilityPlan(request, declaredCapabilityNames(), ctx);
    return {
      refused: Boolean(result.refused),
      why: Array.isArray(result.why) ? result.why.join("; ") : (result.why ?? null),
      driver: result.driver ?? null,
      calls: result.calls ?? [],
      composed: result.composed ?? null,
      observed: result.observed ?? null,
    };
  } finally {
    // The taught registrations are per-ctx: dispose them so the next call
    // re-reads the store instead of meeting a stale name collision.
    for (const dispose of ctx.disposers || []) dispose();
  }
}
