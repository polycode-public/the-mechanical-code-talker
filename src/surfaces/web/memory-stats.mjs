// memory-stats.mjs — the "what does this session's memory hold" reader,
// shared by chat-browser-entry.mjs and ingest-browser-entry.mjs so both
// bundles' stats panels read the exact same breakdown for the exact same
// store shape.
import { loadMemory, readFactRows } from "../../adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../domain/memory/trust.mjs";
import { serializeFactsJsonl } from "../../adapters/memory/export-jsonl.mjs";

/**
 * The memory a running session holds, broken down by where each fact came
 * from: the seed corpus bands it booted with (keyed by the SAME band name
 * build-chat-seed.mjs/extensions.mjs seed under — "human", "seon",
 * "conceptnet" today, whichever bands a future seed adds tomorrow) plus
 * whatever has been taught THIS session. Reuses memory/trust.mjs's own
 * `provenanceTagToSource` against each fact's already-stored provenance
 * tag(s) (readFactRows' `provenance`, the ' | '-joined compat string) rather
 * than inventing a second provenance parse — the same tag chat.mjs's own
 * "(source: ...)" citation already carries, so this panel and a turn's
 * citation always agree on where a fact came from.
 *
 * Returns { total, bandCounts, taught }: `bandCounts` maps a band label to
 * its fact count ("taught this session" for a teach/operator-sourced fact
 * with no corpus band, "other" for anything provenance can't place);
 * `taught` lists every session-taught fact (subject/predicate/object + its
 * own provenance tag), most-recently-taught last — a stats panel's
 * provenance column reads straight off this, no further lookup needed.
 */
export async function memoryStats(memoryDir) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const bandCounts = {};
  const taught = [];
  for (const row of rows) {
    const tags = String(row.provenance || "").split(" | ").filter(Boolean);
    let band = null;
    let isTaught = false;
    let taughtTag = "";
    for (const tag of tags) {
      const src = provenanceTagToSource(tag);
      if (!src) continue;
      // corpusWeak (a /r/RelatedTo-strength triple, e.g. ConceptNet's or
      // SEON's own weaker associations) names the SAME band as corpus (a
      // /r/IsA-strength one) — both carry `src.name`, and a band count that
      // dropped the weak tier would undercount a corpus by exactly its
      // weak-relation facts (SEON: 19 of them, all `corpus-weak:seon`).
      if ((src.kind === "corpus" || src.kind === "corpusWeak") && src.name) band = src.name;
      if (src.kind === "teach" || src.kind === "operator") { isTaught = true; taughtTag = tag; }
    }
    const label = band || (isTaught ? "taught this session" : "other");
    bandCounts[label] = (bandCounts[label] || 0) + 1;
    if (isTaught) taught.push({ subject: row.subject, predicate: row.predicate, object: row.object, tag: taughtTag });
  }
  return { total: rows.length, bandCounts, taught };
}

/**
 * The session's whole triple store as JSONL — one
 * { subject, predicate, object, provenance } object per line, the same shape
 * `tmct extract` and `tmct memory --export` emit. Reads the live memory the
 * same way memoryStats does; a page offers this as a download.
 */
export async function exportFactsJsonl(memoryDir) {
  return serializeFactsJsonl(await loadMemory(memoryDir));
}
