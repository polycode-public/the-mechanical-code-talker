// tmct_export — the memory store's every Fact as JSONL, one
// {subject, predicate, object, provenance} object per line, in the same shape
// `tmct extract` and `tmct memory --export` emit. A triple-store dump for
// backup or audit; provenance rides on every line, so a re-import keeps it.
//
// Reads the conversational-memory store (not the code-map graph), so it owns
// its own load and answers with or without a code graph present.

import { serializeFactsJsonl } from "../../adapters/memory/export-jsonl.mjs";
import { dirname } from "node:path";
import { loadMemory, openConfiguredMemoryBackend } from "../../adapters/memory/core.mjs";

export async function tmct_export(_args, { config, memoryBackend = null }) {
  // Prefer a caller-supplied backend handle (e.g. an already-open session's
  // memory store) over re-deriving one from config/tmct.toml — re-deriving
  // can silently land on a different backend than the one the caller is
  // actually using. A caller-supplied handle is caller-owned, so it is never
  // closed here; only a backend this call opened itself gets closed.
  const opened = memoryBackend ? null : await openConfiguredMemoryBackend(dirname(dirname(config.graphFile)));
  const dir = memoryBackend || opened.dir;
  try {
    const jsonl = serializeFactsJsonl(await loadMemory(dir));
    return jsonl || "(the memory store holds no facts to export)";
  } finally {
    if (opened) await opened.close();
  }
}

// The memory store is this tool's only source — it answers with or without a
// code-map graph, so the shared code-graph load (which refuses an empty graph)
// must not gate it.
tmct_export.ownsGraphLoad = true;
