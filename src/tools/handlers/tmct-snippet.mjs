// tmct_snippet — the exact source of one symbol's line span, plus a one-line in-repo
// call hint. Does its own safe span read rather than delegating to svc.snippet(), which
// would drop the candidates / call hint / truncation notice this presentation carries.

import { readFile } from "node:fs/promises";
import { ToolError } from "../../adapters/config.mjs";
import { readSpanSafe } from "../../adapters/source-slice.mjs";
import { siteOf, callHint } from "../../domain/codegraph.mjs";
import { requiredArg, resolveOrThrow, SNIPPET_MAX_LINES } from "./kit.mjs";

export async function tmct_snippet(args, { graph, svc, repoRoot }) {
  const symbol = requiredArg(args, "symbol");
  const { match, candidates } = resolveOrThrow(svc, symbol, "symbol");
  const site = siteOf(match);
  if (!site) {
    throw new ToolError(
      `"${match.label}" (${match.class || "Entity"}) has no source span in the graph — ` +
        "it is likely a module. Use tmct_describe for its contents, then tmct_snippet one of the functions/classes it defines.",
    );
  }
  let sliced;
  try {
    sliced = await readSpanSafe({
      readFile, repoRoot, path: site.path, start: site.start, end: site.end, maxLines: SNIPPET_MAX_LINES,
    });
  } catch (e) {
    if (e instanceof ToolError) throw e; // path-traversal guard: message already names the offending path
    throw new ToolError(`could not read ${site.path} (${e?.code || e?.message || e})`);
  }
  const { text: body, truncated } = sliced;
  const span = site.end > site.start ? `${site.start}-${site.end}` : `${site.start}`;
  const header = `${match.label} — ${match.class || "Entity"} @ ${site.path}:${span}`;
  const note = truncated ? `\n… (truncated to ${SNIPPET_MAX_LINES} lines; full span ${span})` : "";
  const cand = candidates.length ? `\n(other matches: ${candidates.map((c) => c.label).join(", ")})` : "";
  const hint = callHint(graph, match);
  return `${header}\n${body}${note}${hint ? `\n${hint}` : ""}${cand}`;
}
