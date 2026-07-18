#!/usr/bin/env node
// build-worlds-pack.mjs — build corpus/worlds/ (the shipped worlds pack) from
// the hand-authored world sources in corpus/worlds/src/*.jsonl. One source
// file per world; the file's basename is the world name and every row must
// carry it. Byte-deterministic: same sources in, same bytes out (rows are
// re-serialized canonically, gzip headers carry no timestamp, and the
// manifest records content hashes, never a build date). Budget asserts keep
// the pack a toy-sized shipped artifact, mirroring the reference pack's own
// budget discipline.
//
//   npm run gen:worlds-pack

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isWorldName, isWorldRow, isWorldFactRow, isWorldRuleRow, isWorldMetaRow,
} from "../src/domain/worlds-pack.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "corpus", "worlds", "src");
const OUT_DIR = join(REPO_ROOT, "corpus", "worlds");

const BUDGETS = {
  sourceBytesPerWorld: 128 * 1024,
  shardGzBytes: 32 * 1024,
  indexGzBytes: 4 * 1024,
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function fail(msg) {
  console.error(`build-worlds-pack: ${msg}`);
  process.exit(1);
}

function readWorldSource(file, worldName) {
  const raw = readFileSync(file);
  if (raw.length > BUDGETS.sourceBytesPerWorld) {
    fail(`${worldName}: source is ${raw.length} bytes, over the ${BUDGETS.sourceBytesPerWorld}-byte budget — cut world content, never raise the number`);
  }
  const rows = [];
  const lines = raw.toString("utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      fail(`${worldName} line ${i + 1}: not JSON — ${e.message}`);
    }
    if (!isWorldRow(row)) fail(`${worldName} line ${i + 1}: not a valid world row — ${line.trim()}`);
    if (row.world !== worldName) fail(`${worldName} line ${i + 1}: row.world is "${row.world}", must match the file name`);
    rows.push(row);
  }
  const metas = rows.filter(isWorldMetaRow);
  if (metas.length !== 1) fail(`${worldName}: needs exactly one meta row (the opening), found ${metas.length}`);
  if (!rows.some(isWorldFactRow)) fail(`${worldName}: needs at least one fact row`);
  if (!rows.some(isWorldRuleRow)) fail(`${worldName}: needs at least one rule row (its action families)`);
  return { rows, sourceSha256: sha256(raw), sourceBytes: raw.length };
}

function main() {
  let sourceFiles;
  try {
    sourceFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    fail(`no source directory at ${SRC_DIR}`);
  }
  if (!sourceFiles.length) fail(`no *.jsonl world sources in ${SRC_DIR}`);

  mkdirSync(join(OUT_DIR, "shards"), { recursive: true });

  const index = {};
  const manifestFiles = [];
  const sources = [];
  const counts = { worlds: 0, facts: 0, rules: 0 };

  for (const file of sourceFiles) {
    const worldName = file.replace(/\.jsonl$/, "");
    if (!isWorldName(worldName)) fail(`"${worldName}" is not a valid world name (lowercase, hyphen-joined)`);
    const { rows, sourceSha256, sourceBytes } = readWorldSource(join(SRC_DIR, file), worldName);

    const body = rows.map((r) => JSON.stringify(r)).join("\n");
    const gz = gzipSync(Buffer.from(`${body}\n`, "utf8"));
    if (gz.length > BUDGETS.shardGzBytes) {
      fail(`${worldName}: shard is ${gz.length} gz bytes, over the ${BUDGETS.shardGzBytes}-byte budget — cut world content, never raise the number`);
    }
    const shardRel = join("shards", `${worldName}.jsonl.gz`);
    writeFileSync(join(OUT_DIR, shardRel), gz);
    manifestFiles.push({ file: `shards/${worldName}.jsonl.gz`, bytes: gz.length, sha256: sha256(gz) });

    index[worldName] = { s: worldName };
    sources.push({ file: `src/${file}`, bytes: sourceBytes, sha256: sourceSha256 });
    counts.worlds += 1;
    counts.facts += rows.filter(isWorldFactRow).length;
    counts.rules += rows.filter(isWorldRuleRow).length;
  }

  const indexGz = gzipSync(Buffer.from(JSON.stringify(index), "utf8"));
  if (indexGz.length > BUDGETS.indexGzBytes) {
    fail(`index is ${indexGz.length} gz bytes, over the ${BUDGETS.indexGzBytes}-byte budget`);
  }
  writeFileSync(join(OUT_DIR, "index.json.gz"), indexGz);
  manifestFiles.unshift({ file: "index.json.gz", bytes: indexGz.length, sha256: sha256(indexGz) });

  const manifest = {
    version: 1,
    generated: "by scripts/build-worlds-pack.mjs from corpus/worlds/src/",
    counts,
    budgets: BUDGETS,
    sources,
    files: manifestFiles,
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`worlds pack built: ${counts.worlds} world(s), ${counts.facts} facts, ${counts.rules} rules -> ${OUT_DIR}`);
}

main();
