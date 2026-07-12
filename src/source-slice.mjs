// Shared, safe source-span slicing for the tool layer (src/server.mjs) and the
// source-capable Repository Interface provider (src/providers/graph-service.mjs).
//
// Two halves, deliberately split:
//   - sliceSpan   — PURE. Given an in-memory `lines` array, extracts + line-numbers
//                   one span. No fs, no path logic. Lifted byte-identical from the
//                   slicing logic that used to live inline in server.mjs (buildContextBundle's
//                   `sliceBody` closure and the tmct_snippet dispatch branch).
//   - readSpanSafe — the fs-touching half. Resolves `join(repoRoot, path)` with Node's
//                   `resolve()` and REFUSES to read anything that resolves outside
//                   `repoRoot` before ever calling the injected `readFile`. This is the
//                   fix for a real path-traversal gap: graph.json's `site.path` values are
//                   data (parsed from a JSON artifact on disk), not trusted input — a
//                   crafted or corrupted graph with a `../../etc/passwd`-shaped path must
//                   never reach an unguarded readFile.

import { resolve, sep } from "node:path";
import { ToolError } from "./config.mjs";

/**
 * Extract and line-number one span from an in-memory `lines` array (already split on "\n").
 * Pure — no fs. `start`/`end` are 1-based, inclusive, graph-derived (may be out of range).
 * `maxLines` (optional) caps the span length, truncating from `start`; omit for no cap.
 * Returns { start, end, text, truncated } where start/end are the CLAMPED bounds actually
 * sliced (not the raw input) and text is "<lineNo>\t<content>" per line, joined with "\n".
 */
export function sliceSpan(lines, start, end, maxLines) {
  const s = Math.max(1, start);
  let e = Math.min(lines.length, end);
  let truncated = false;
  if (maxLines != null && e - s + 1 > maxLines) {
    e = s + maxLines - 1;
    truncated = true;
  }
  const text = lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join("\n");
  return { start: s, end: e, text, truncated };
}

/**
 * Safely read `path` (relative, from the graph) rooted at `repoRoot`, then optionally slice
 * one span out of it. `readFile` is injected (e.g. node:fs/promises' readFile) — this module
 * never imports fs itself, so callers control the fs capability.
 *
 * SECURITY: resolves the joined path and verifies it is `repoRoot` itself or a descendant of
 * it (`resolved === repoRoot || resolved.startsWith(repoRoot + sep)`) BEFORE calling `readFile`.
 * A path that escapes repoRoot (e.g. via `../../etc/passwd`-shaped graph data) throws a
 * ToolError naming the offending path — never reaches fs.
 *
 * When `start`/`end` are omitted, returns the whole file as `{ lines }` (for callers that need
 * to slice multiple spans out of the same file without re-reading it — see buildContextBundle).
 * When both are given, also slices via sliceSpan and spreads its result in.
 */
export async function readSpanSafe({ readFile, repoRoot, path, start, end, maxLines }) {
  // Normalize repoRoot to absolute here too (defense in depth) — resolve(repoRoot, path)
  // is always absolute, so comparing it against a RELATIVE repoRoot would make this guard
  // reject every read, not just traversal attempts (the actual bug this normalization
  // fixes; callers should already pass an absolute repoRoot via src/config.mjs.
  const root = resolve(repoRoot);
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new ToolError(`refusing to read outside the repository root: ${path}`);
  }
  const text = await readFile(resolved, "utf8");
  const lines = text.split("\n");
  if (start == null || end == null) return { lines };
  return { lines, ...sliceSpan(lines, start, end, maxLines) };
}
