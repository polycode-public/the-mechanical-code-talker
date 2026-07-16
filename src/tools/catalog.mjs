// The cold-tool catalog written to <repo>/.tmct/TOOLS.md by the index step.
// Rendered from the tool definitions, so a tool documents itself once.

import { HOT_TOOLS, COLD_TOOLS } from "./definitions.mjs";

/** Markdown catalog of the COLD tools (everything except the hot catalog tools): each
 *  with a one-line purpose and the exact Bash invocation via the CLI `cli <tool>` route.
 *  Pure — `cliPath` is the absolute path to bin/cli.mjs the caller wants embedded. */
export function renderToolsCatalog(cliPath) {
  const hot = HOT_TOOLS.map((t) => `\`${t.name}\` (${t.summary})`).join(", ");
  const lines = [
    "# tmct cold-tool catalog",
    "",
    `The hot tools — ${hot} — carry full schemas in the TOOLS catalog.`,
    "",
    "The cold tools below invoke via the CLI:",
    "",
  ];
  for (const { name, summary, example } of COLD_TOOLS) {
    lines.push(`## ${name}`);
    lines.push(summary);
    lines.push("```bash");
    lines.push(`node ${cliPath} cli ${name} '${JSON.stringify(example)}'`);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
