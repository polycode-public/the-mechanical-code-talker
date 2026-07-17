// Parses the site's HTML example blocks into the same shape test/readme's
// harness runs, so a transcript on the home page is replayed against the live
// CLI exactly as a README fence is.
//
// A <pre> opts in by carrying the command it reproduces:
//
//   data-tmct-session="tmct chat --ephemeral"   the command to start; the
//                                               block's `tmct> text` lines are
//                                               typed input and every other
//                                               non-blank line must appear in
//                                               stdout in order
//   data-tmct-cwd="repo"                        run from a clone's root (for
//                                               blocks naming a path that ships
//                                               in the repo) instead of a fresh
//                                               temp dir
//
// A <pre> without the attribute is prose or an install line, and is not run.
// "…" lines elide output, the same as in a README session fence.
import { readFileSync } from "node:fs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

const decodeEntities = (text) =>
  text.replace(/&(#?\w+);/g, (whole, name) => ENTITIES[name] ?? whole);

const stripTags = (html) => html.replace(/<[^>]*>/g, "");

/** Every runnable example block on an HTML page, in document order. */
export function extractPageSessions(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const blocks = [];
  const pattern = /<pre\b([^>]*)>([\s\S]*?)<\/pre>/g;
  for (const [, rawAttrs, inner] of html.matchAll(pattern)) {
    const cmd = /data-tmct-session="([^"]*)"/.exec(rawAttrs)?.[1];
    if (!cmd) continue;
    const cwd = /data-tmct-cwd="([^"]*)"/.exec(rawAttrs)?.[1];
    const attrs = { cmd: decodeEntities(cmd) };
    if (cwd) attrs.cwd = cwd;
    blocks.push({
      tag: "session",
      attrs,
      source: htmlPath.split("/").at(-1),
      body: decodeEntities(stripTags(inner)).replace(/^\n/, ""),
      startLine: html.slice(0, html.indexOf(inner)).split("\n").length,
      label: attrs.cmd,
    });
  }
  return blocks;
}
