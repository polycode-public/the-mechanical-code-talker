// Parses README.md's fenced code blocks into runnable specs. The fence info
// string tells the harness how to treat each block:
//
//   js                 a runnable ES module; executes via `node -e` in a temp
//                      dir where the package name resolves through a
//                      node_modules symlink to this repo (so the exports map
//                      is honored), or from the repo root with `cwd=repo`
//   bash               runnable shell lines; PATH puts a `tmct` binary and an
//                      `npx` wrapper in front of `node bin/tmct.mjs`
//   session            a terminal transcript: an optional `$ command` line
//                      starts the process, `tmct> text` lines are typed input,
//                      every other non-blank line must appear in the process's
//                      stdout in order ("…"/"..." lines mark elided output)
//   output             the full stdout of a paired command: `cmd="..."` names
//                      it, otherwise the nearest preceding runnable block's
//                      captured stdout is compared ("…"/"..." lines elide)
//   output:help:<name> an excerpt that must appear verbatim in the live
//                      `tmct --help` output (<name> labels the section)
//   toml               not executed; validated by parsing with smol-toml and
//                      loading through src/toml-config.mjs
//   text               illustrative only; never executed or asserted
//
// Attributes after the tag refine treatment:
//   e2e                heavy; runs from e2e/readme-examples.test.mjs, not the
//                      fast tier
//   skip=network       never run (would touch the network)
//   cwd=repo           run from a clone's root instead of a temp dir
//   cmd="..."          the command a session or output block reproduces
//   setup="..."        shell run in the block's cwd before its command
import { readFileSync } from "node:fs";

const RUNNABLE_TAGS = new Set(["js", "bash", "session"]);

function parseInfoString(info) {
  const tokens = [...info.matchAll(/([\w:.-]+)=("[^"]*"|\S+)|(\S+)/g)];
  if (tokens.length === 0) return { tag: "", attrs: {} };
  const [first, ...rest] = tokens;
  const attrs = {};
  const readToken = (match) => {
    if (match[3] !== undefined) attrs[match[3]] = true;
    else attrs[match[1]] = match[2].replaceAll('"', "");
  };
  for (const token of rest) readToken(token);
  let tag = first[3];
  if (tag === undefined) {
    tag = "";
    readToken(first);
  }
  return { tag, attrs };
}

export function extractReadmeBlocks(readmePath) {
  const lines = readFileSync(readmePath, "utf8").split("\n");
  const blocks = [];
  let open = null;
  let lastRunnableIndex = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("```")) continue;
    if (open === null) {
      const { tag, attrs } = parseInfoString(lines[i].slice(3).trim());
      open = { index: blocks.length, tag, attrs, startLine: i + 1, bodyFrom: i + 1 };
    } else {
      open.body = lines.slice(open.bodyFrom, i).join("\n");
      delete open.bodyFrom;
      open.pairedRunnableIndex = open.tag === "output" ? lastRunnableIndex : null;
      if (RUNNABLE_TAGS.has(open.tag)) lastRunnableIndex = open.index;
      blocks.push(open);
      open = null;
    }
  }
  if (open !== null) throw new Error(`unclosed fence at README line ${open.startLine}`);
  return blocks;
}
