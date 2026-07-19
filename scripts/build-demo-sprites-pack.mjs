#!/usr/bin/env node
// scripts/build-demo-sprites-pack.mjs — cut the sprite tier's own small
// browser-fetchable manifest: public/sprites-pack/manifest.json, the full
// resolved data/sprites-large/*.toml template set (material references
// already expanded against sprite-materials.mjs's shared palette) as one
// flat JSON array. Unlike the reference pack (a much larger corpus, sharded
// behind a term index) this pack is small enough that "the whole template
// array" is the unit — no index, no shards needed at this size.
//
//   node scripts/build-demo-sprites-pack.mjs [--out <dir>]
//
// public/sprites-pack/ is generated output, ignored by git (like
// public/engine/ and public/reference-pack/) and rebuilt by the site build.
// Nothing browser-side reads data/sprites-large/ directly — only this
// script, in Node, at build time (package.json's own "!data/sprites-large/"
// keeps the source TOML out of the npm package entirely; see
// src/adapters/corpus/sprite-large-template-files.mjs's own header).

import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "public", "sprites-pack");

/** Build the manifest at `outDir` (created if missing) and return
 *  { manifest, bytes, outDir }. Pure apart from the fs write. */
export function buildDemoSpritesPack({ outDir = OUT_DEFAULT } = {}) {
  const templates = readSpriteLargeTemplateFiles();
  mkdirSync(outDir, { recursive: true });
  const manifest = { version: 1, templates };
  const body = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "manifest.json"), body);
  return { manifest, bytes: body.length, outDir };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg("--out", OUT_DEFAULT);
  await rm(outDir, { recursive: true, force: true });
  const { manifest, bytes } = buildDemoSpritesPack({ outDir });
  console.log(`build-demo-sprites-pack: wrote ${manifest.templates.length} template(s), ${bytes} bytes, to ${outDir}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
