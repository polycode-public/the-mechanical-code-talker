#!/usr/bin/env node
// scripts/build-demo-pack.mjs — cut the tiny web subset of the reference pack
// the demo site serves: public/reference-pack/index.json (term -> article id)
// plus one small JSON per article. The browser cannot read the gzipped shard
// layout, so the demo ships plain fetchable JSON for a handful of terms and
// registers a fetch-backed provider over it (the provider seam in
// src/adapters/corpus/reference-pack.mjs).
//
//   node scripts/build-demo-pack.mjs [--src <pack dir>] [--terms a,b,c] [--out <dir>]
//
// The term allowlist comes from public/chat-demos.mjs's REFERENCE_PACK_TERMS
// export where that module exists, else from --terms. A named term missing
// from the pack fails the build loudly — a demo that silently loses its
// articles would look like the miss wall, not a build bug.
//
// public/reference-pack/ is generated output, ignored by git (like
// public/engine/ and public/demo-graph.json) and rebuilt by the site build.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReferenceArticle, loadReferenceIndex, referencePackDir, clearReferencePackCache } from "../src/adapters/corpus/reference-pack.mjs";
import { isReferenceArticleRow } from "../src/domain/reference-pack.mjs";
import { normFactTerm } from "../src/domain/hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "public", "reference-pack");
const CHAT_DEMOS_FILE = join(REPO_ROOT, "public", "chat-demos.mjs");

export const DEMO_PACK_BYTES_MAX = 100 * 1024;

export function articleIdFor(term) {
  return String(term).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Build the subset: every allowlisted term must resolve through the pack at
 * `srcDir` (aliases welcome — they share their target's article file).
 * Returns the emitted manifest ({ version, license, attribution, terms }).
 */
export function buildDemoPack({ srcDir, terms, outDir }) {
  if (!Array.isArray(terms) || terms.length === 0) {
    throw new Error("build-demo-pack: no terms — export REFERENCE_PACK_TERMS from public/chat-demos.mjs or pass --terms a,b,c");
  }
  clearReferencePackCache();
  if (!loadReferenceIndex(srcDir)) {
    throw new Error(`build-demo-pack: no readable reference pack at ${srcDir} — run \`npm run gen:reference-pack\` first (or pass --src)`);
  }

  const termToId = {};
  const rowsById = new Map();
  const missing = [];
  for (const raw of terms) {
    const term = normFactTerm(raw);
    const row = loadReferenceArticle(srcDir, term);
    if (!row || !isReferenceArticleRow(row)) {
      missing.push(term);
      continue;
    }
    const id = articleIdFor(row.term);
    termToId[term] = id;
    rowsById.set(id, row);
  }
  if (missing.length) {
    throw new Error(`build-demo-pack: term(s) not in the reference pack at ${srcDir}: ${missing.join(", ")}`);
  }

  mkdirSync(join(outDir, "articles"), { recursive: true });
  let totalBytes = 0;
  const emit = (rel, value) => {
    const body = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
    writeFileSync(join(outDir, rel), body);
    totalBytes += body.length;
  };
  for (const id of [...rowsById.keys()].sort()) {
    emit(join("articles", `${id}.json`), rowsById.get(id));
  }
  const manifest = {
    version: 1,
    license: "CC-BY-SA-4.0",
    attribution: "Simple English Wikipedia contributors, CC BY-SA 4.0 — see corpus/reference/LICENSE-NOTICE",
    terms: Object.fromEntries(Object.entries(termToId).sort(([a], [b]) => a.localeCompare(b))),
  };
  emit("index.json", manifest);
  if (totalBytes > DEMO_PACK_BYTES_MAX) {
    throw new Error(`build-demo-pack: ${totalBytes} bytes exceeds the ${DEMO_PACK_BYTES_MAX}-byte demo budget — shorten the allowlist`);
  }
  return manifest;
}

async function allowlistedTerms(cliTerms) {
  if (existsSync(CHAT_DEMOS_FILE)) {
    const mod = await import(CHAT_DEMOS_FILE);
    if (Array.isArray(mod.REFERENCE_PACK_TERMS) && mod.REFERENCE_PACK_TERMS.length) return mod.REFERENCE_PACK_TERMS;
  }
  return cliTerms ? cliTerms.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const srcDir = arg("--src", referencePackDir());
  const outDir = arg("--out", OUT_DEFAULT);
  const terms = await allowlistedTerms(arg("--terms", ""));
  await rm(outDir, { recursive: true, force: true });
  const manifest = buildDemoPack({ srcDir, terms, outDir });
  const count = Object.keys(manifest.terms).length;
  console.log(`build-demo-pack: wrote ${count} term(s) to ${outDir}`);
  console.log(`  sha256(index.json) ${createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16)}…`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
