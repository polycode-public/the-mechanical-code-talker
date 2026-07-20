#!/usr/bin/env node
// scripts/build-demo-pack.mjs — cut the browser-fetchable subset of the
// reference pack the demo site serves: public/reference-pack/index.json
// (term -> article id) plus one small JSON per article. The browser cannot
// read the gzipped shard layout, so the demo ships plain fetchable JSON and
// registers a fetch-backed provider over it (the provider seam in
// src/adapters/corpus/reference-pack.mjs).
//
//   node scripts/build-demo-pack.mjs [--src <pack dir>] [--terms a,b,c] [--out <dir>]
//
// Every term default: with no --terms, the subset is EVERY term the pack at
// `--src` already resolves (allPackTerms) — every already-built shard reaches
// public/reference-pack/, not a curated slice. `--terms` still narrows it
// explicitly (a quick local build, a regression repro); a named term missing
// from the pack fails the build loudly either way — a demo that silently
// loses its articles would look like the miss wall, not a build bug.
//
// public/reference-pack/ is generated output, ignored by git (like
// public/engine/ and public/demo-graph.json) and rebuilt by the site build.
// The fetch stays lazy and per-citation either way (chat-browser-entry.mjs's
// fetchPackProvider) — growing this subset grows what the page CAN reach on
// demand, never what it loads on open.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReferenceArticle, loadReferenceIndex, referencePackDir, clearReferencePackCache } from "../src/adapters/corpus/reference-pack.mjs";
import { isReferenceArticleRow } from "../src/domain/reference-pack.mjs";
import { normFactTerm } from "../src/domain/hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "public", "reference-pack");

// Every term key the pack's own index already resolves (aliases included —
// buildDemoPack dedupes them onto their shared article). Sorted so the
// manifest and the emitted file set stay deterministic build to build.
export function allPackTerms(srcDir) {
  const index = loadReferenceIndex(srcDir);
  return index ? Object.keys(index).sort() : [];
}

// The emitted subset's own byte budget: the pack's real uncompressed prose
// (~4.2 MB for today's 3,887-article corpus/reference/ build) at ~1.08 KB
// average per article, gzip's usual ~3x expansion off the pack's 1.4 MB
// on-disk (gzipped) footprint. A build that clears this is emitting
// meaningfully MORE than what's already built and committed — lower the
// corpus rebuild's own cap (scripts/fetch-reference-pack.mjs), never raise
// this number to paper over it.
export const DEMO_PACK_BYTES_MAX = 6 * 1024 * 1024;

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
    throw new Error("build-demo-pack: no terms — pass terms (allPackTerms(srcDir) for everything already built) or --terms a,b,c");
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const srcDir = arg("--src", referencePackDir());
  const outDir = arg("--out", OUT_DEFAULT);
  const cliTerms = arg("--terms", "");
  // --terms narrows explicitly; with none given, the CLI build gets the
  // same "everything already built" default the site build uses.
  const terms = cliTerms ? cliTerms.split(",").map((t) => t.trim()).filter(Boolean) : allPackTerms(srcDir);
  await rm(outDir, { recursive: true, force: true });
  const manifest = buildDemoPack({ srcDir, terms, outDir });
  const count = Object.keys(manifest.terms).length;
  console.log(`build-demo-pack: wrote ${count} term(s) to ${outDir}`);
  console.log(`  sha256(index.json) ${createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16)}…`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
