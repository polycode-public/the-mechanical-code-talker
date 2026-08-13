// localeCompare sorts by the reader's OS locale, so two readers holding one
// fact set can render its rows in a different order — the same
// pure-function-of-the-fact-set break arrival-order sorting causes, routed
// through the locale instead of array position. src/domain/memory/fact-order.mjs
// states the rule and its codepoint comparator; this checks the files a
// recent sweep converted to it stay converted.
//
// Scope is these named files, not a directory sweep or a repo-wide ban: a UI
// label list or a hard-coded menu sorting by locale is legitimate and outside
// this guard's concern. Naming exactly the converted files means the guard
// only ever fails on an actual regression in a site already fixed once, never
// on an unrelated call this test was never meant to police. The list grows a
// file at a time, as each one's own sites are converted and proved; a
// store-derived sort in a file not named here is not yet covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARDED_FILES = [
  join(ROOT, "src", "adapters", "memory", "core.mjs"),
  join(ROOT, "src", "adapters", "memory", "blocks.mjs"),
  join(ROOT, "src", "domain", "digest", "select.mjs"),
  join(ROOT, "src", "domain", "digest", "compose.mjs"),
  join(ROOT, "src", "services", "chat.mjs"),
  join(ROOT, "src", "services", "ledger-viz.mjs"),
  join(ROOT, "src", "domain", "news-feed.mjs"),
];

/** Every `.localeCompare(` call site in `text` that isn't inside a comment,
 *  as `{ number, line }` (1-based line numbers). Strips `//` line comments
 *  and `/* ... *\/` block comments, including ones spanning several lines,
 *  since each guarded file carries a "never localeCompare" reminder in prose
 *  that must not itself be mistaken for a call. */
function localeCompareCallSites(text) {
  const offenders = [];
  let inBlockComment = false;
  const rawLines = text.split("\n");
  for (let i = 0; i < rawLines.length; i += 1) {
    let code = rawLines[i];
    if (inBlockComment) {
      const end = code.indexOf("*/");
      if (end === -1) continue;
      code = code.slice(end + 2);
      inBlockComment = false;
    }
    const lineCommentAt = code.indexOf("//");
    if (lineCommentAt !== -1) code = code.slice(0, lineCommentAt);
    const blockStart = code.indexOf("/*");
    if (blockStart !== -1) {
      const blockEnd = code.indexOf("*/", blockStart + 2);
      if (blockEnd === -1) {
        inBlockComment = true;
        code = code.slice(0, blockStart);
      } else {
        code = code.slice(0, blockStart) + code.slice(blockEnd + 2);
      }
    }
    if (/\.localeCompare\(/.test(code)) offenders.push({ number: i + 1, line: rawLines[i].trim() });
  }
  return offenders;
}

test("the sweep's converted fact-store files stay off localeCompare", async () => {
  const offenders = [];
  for (const file of GUARDED_FILES) {
    const text = await readFile(file, "utf8");
    for (const { number, line } of localeCompareCallSites(text)) {
      offenders.push(`${file.slice(ROOT.length + 1)}:${number}: ${line}`);
    }
  }
  assert.deepEqual(offenders, [], [
    "localeCompare sorts fact-store rows by the reader's OS locale, so two",
    "readers can render one fact set in a different order. Use the codepoint",
    "comparator from src/domain/memory/fact-order.mjs instead. Offending line(s):",
    ...offenders,
  ].join("\n"));
});
