#!/usr/bin/env node
// scripts/build-p2p-vendor.mjs — bundle tmct's P2P layer into ONE shared
// first-party asset, public/vendor/p2p.js, so every page that can join a world
// loads the same same-origin copy instead of carrying its own. The same
// arrangement scripts/build-wink-vendor.mjs already gives the lemma/POS tier:
// ESM, dynamically imported by a page's own inline script, one cached copy
// site-wide.
//
// The node-builtin stubs are the same ones the page bundles use — the memory
// core this reaches for its merge step links a filesystem persistence path it
// never runs against an in-memory handle.

import { build } from "esbuild";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubNodeBuiltins, stubNodeZlib } from "./lib/browser-bundle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Build `<siteDir>/vendor/p2p.js` (ESM, minified) and return
 *  { outPath, bytes }. Write-then-rename so a concurrent reader always sees a
 *  complete file. */
export async function buildP2pVendor(siteDir = join(ROOT, "public")) {
  const outPath = join(siteDir, "vendor", "p2p.js");
  const result = await build({
    entryPoints: [join(ROOT, "src", "surfaces", "web", "p2p-browser-entry.mjs")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent",
    plugins: [stubNodeZlib, stubNodeBuiltins],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (result.errors.length) {
    console.error(result.errors);
    process.exit(1);
  }
  const contents = result.outputFiles[0].contents;
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(tmpPath, contents);
  await rename(tmpPath, outPath);
  return { outPath, bytes: contents.byteLength };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { outPath, bytes } = await buildP2pVendor(process.argv[2]);
  console.log(`built ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
}
