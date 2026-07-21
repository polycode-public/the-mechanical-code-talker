#!/usr/bin/env node
// scripts/build-wink-vendor.mjs — bundle wink-nlp + its English model into ONE
// shared first-party asset, public/vendor/wink.js, so every page's lemma/POS
// tier loads same-origin instead of from a CDN. One cached copy site-wide: the
// pages import this ESM module dynamically and hand its named exports to
// src/adapters/wink-model.mjs's registerWinkModel seam, exactly as the CDN
// pair used to arrive. Both packages are plain CJS with `main` entries and no
// runtime fs use, so a static import bundles cleanly.

import { build } from "esbuild";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const VENDOR_ENTRY = 'import winkNLP from "wink-nlp";\n'
  + 'import model from "wink-eng-lite-web-model";\n'
  + "export { winkNLP, model };\n";

/** Build `<siteDir>/vendor/wink.js` (ESM, minified) and return
 *  { outPath, bytes }. Write-then-rename so a concurrent reader always sees a
 *  complete file — the same idiom scripts/lib/browser-bundle.mjs uses. */
export async function buildWinkVendor(siteDir = join(ROOT, "public")) {
  const outPath = join(siteDir, "vendor", "wink.js");
  const result = await build({
    stdin: { contents: VENDOR_ENTRY, resolveDir: ROOT, sourcefile: "wink-vendor-entry.mjs", loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent",
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
  const { outPath, bytes } = await buildWinkVendor(process.argv[2]);
  console.log(`built ${outPath} (${(bytes / 1048576).toFixed(2)} MB)`);
}
