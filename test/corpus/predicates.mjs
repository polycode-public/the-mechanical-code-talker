// Named predicates that corpus rows can reference by name (mode: "predicate")
// instead of an exact string or a regex. Each takes the turn result (or, for
// bench-smoke rows, the finished process result) plus the row's argument, and
// returns truthy on pass.
import { readFileSync } from "node:fs";
import path from "node:path";

/** The turn's answer (or a process result's stdout) contains `needle`,
 *  case-insensitively. */
export function answerIncludes(result, needle) {
  const text = String(result?.answer ?? result?.stdout ?? "");
  return text.toLowerCase().includes(String(needle).toLowerCase());
}

/** The turn produced a non-empty answer. */
export function answerNonEmpty(result) {
  return String(result?.answer ?? "").trim() !== "";
}

/** Parse the product JSONL a bench row's script wrote under its scratch
 *  directory. Returns the rows, or null when the run failed or wrote nothing
 *  usable — the per-rig predicates below build on this. */
function benchProductRows(result, file = "out/product.jsonl") {
  if (result?.code !== 0 || !result?.scratchDir) return null;
  let text;
  try {
    text = readFileSync(path.join(result.scratchDir, file), "utf8");
  } catch {
    return null;
  }
  try {
    const rows = text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** chatbench completed and every product row is gradeable: a case id, a
 *  tier-1 verdict, and a non-empty transcript for the judge to read. */
export function chatbenchProductIsGradeable(result, file) {
  const rows = benchProductRows(result, file);
  return Boolean(rows && rows.every((r) =>
    typeof r.caseId === "string"
    && typeof r.tier1?.pass === "boolean"
    && Array.isArray(r.transcript) && r.transcript.length > 0));
}

/** infbench completed and every product row carries a graded verdict, with
 *  both drive points (kernel + chat) represented. */
export function infbenchProductIsGradeable(result, file) {
  const rows = benchProductRows(result, file);
  return Boolean(rows && rows.every((r) =>
    typeof r.caseId === "string"
    && typeof r.pass === "boolean"
    && typeof r.fabricated === "boolean"
    && typeof r.band === "string")
    && new Set(rows.map((r) => r.arm)).size === 2);
}

/** agentbench completed and every product row carries a graded verdict with
 *  the hallucination axis recorded. */
export function agentbenchProductIsGradeable(result, file) {
  const rows = benchProductRows(result, file);
  return Boolean(rows && rows.every((r) =>
    typeof r.caseId === "string"
    && typeof r.verdict?.pass === "boolean"
    && Array.isArray(r.verdict.hallucinated)));
}
