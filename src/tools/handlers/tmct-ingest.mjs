// tmct_ingest — ground plain text into the conversational-memory store with the
// same deterministic recognizer the chat teach lane uses. The strict tier keeps
// only sentences the recognizer turns into stored facts; with optimistic:true the
// lower-trust fuzzy tier also reaches the sentences it skips. Answers with the
// canonical triples it grounded and an honest recognized/skipped summary — no
// LLM, no guessing.
//
// The recognizer (ingestText, src/services/extract-facts.mjs) lives in the SERVICE
// layer, above the tool layer, so this handler never imports it: a service-layer
// caller injects it as `ingest` through dispatchTool's ctx (bin/tmct.mjs's `cli`
// route and the chat surface both hold it). Called without that seam wired, the
// tool says so honestly rather than guessing.
//
// Reads the conversational-memory store (not the code-map graph), so it owns its
// own load and writes with or without a code graph present.

import { dirname } from "node:path";
import { openConfiguredMemoryBackend } from "../../adapters/memory/core.mjs";
import { toolResult } from "./kit.mjs";

export async function tmct_ingest(args, { config, ingest }) {
  const text = String(args?.text ?? "");
  if (!text.trim()) return "(nothing to ingest — pass some text)";
  if (typeof ingest !== "function") {
    return "(ingest isn't wired into this context — invoke tmct_ingest through the CLI `cli` route or the chat surface)";
  }
  const optimistic = args?.optimistic === true;
  const { dir, close } = await openConfiguredMemoryBackend(dirname(dirname(config.graphFile)));
  try {
    const result = await ingest(text, {
      memoryDir: dir, config, sourceTag: "tool", optimistic, canonical: true, findings: true,
    });
    const grounded = result.extracted.length + result.optimistic.length;
    const header = `${result.sentences} sentence(s), ${result.recognized} recognized`
      + (optimistic ? `, ${result.optimistic.length} optimistic candidate(s)` : "")
      + `, ${result.skipped} skipped — ${grounded} fact(s) grounded.`;
    return toolResult({
      content: grounded ? `${header}\n${result.canonical.join("\n")}` : header,
      data: { ...result, grounded },
    });
  } finally {
    await close();
  }
}

// The memory store is this tool's only source — it writes with or without a
// code-map graph, so the shared code-graph load (which refuses an empty graph)
// must not gate it.
tmct_ingest.ownsGraphLoad = true;
