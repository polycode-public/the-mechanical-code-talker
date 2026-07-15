#!/usr/bin/env node
// scripts/check-links.mjs — verify that every RELATIVE markdown link in every
// tracked .md file points at a file or directory that actually exists.
// External URLs (http/https/mailto), pure #anchors and absolute paths are out
// of scope — this catches repo-internal rot (a renamed doc, an archived plan,
// a deleted asset), which is the kind that breaks silently. Dependency-free
// (node builtins + git only) so CI can run it without npm ci. Exits 1 listing
// every broken link.
//
//   node scripts/check-links.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function trackedMarkdownFiles() {
  return execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

// Inline links/images: [text](target "title") — target ends at the first
// whitespace or closing paren. Reference definitions: [label]: target.
const INLINE_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REFERENCE_DEF = /^\s{0,3}\[[^\]]+\]:\s+(\S+)/gm;

export function relativeTargets(markdown) {
  const targets = [];
  for (const regex of [INLINE_LINK, REFERENCE_DEF]) {
    for (const match of markdown.matchAll(regex)) {
      let target = match[1];
      if (/^(https?|mailto|ftp):/i.test(target)) continue;
      if (target.startsWith("#") || target.startsWith("/") || target.startsWith("<")) continue;
      target = decodeURIComponent(target.split("#")[0].split("?")[0]);
      if (!target) continue;
      const line = markdown.slice(0, match.index).split("\n").length;
      targets.push({ target, line });
    }
  }
  return targets;
}

export function brokenLinks() {
  const broken = [];
  for (const file of trackedMarkdownFiles()) {
    const markdown = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const { target, line } of relativeTargets(markdown)) {
      const resolved = join(REPO_ROOT, dirname(file), target);
      if (!existsSync(resolved)) broken.push({ file, line, target });
    }
  }
  return broken;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const broken = brokenLinks();
  if (broken.length) {
    console.error(`${broken.length} broken relative markdown link(s):`);
    for (const b of broken) console.error(`  ${b.file}:${b.line} -> ${b.target}`);
    process.exit(1);
  }
  console.log("links check: OK — every relative markdown link resolves to a real file");
}
