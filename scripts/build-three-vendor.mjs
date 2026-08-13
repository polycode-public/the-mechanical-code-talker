#!/usr/bin/env node
// scripts/build-three-vendor.mjs — bundle Three.js, GLTFLoader, OrbitControls,
// and MeshoptDecoder into ONE shared first-party asset, public/vendor/three.js,
// so every page's 3D scene loads same-origin instead of from a CDN. One cached
// copy site-wide: the pages import this ESM module dynamically and hand its
// named exports to the mudiii scene surface, exactly as the CDN pair would
// arrive. No page loads from a CDN, so a LAN demo works offline.
//
// The bundle includes:
//   - THREE (core three.js library)
//   - GLTFLoader (required for .glb asset pipeline)
//   - OrbitControls (camera interaction)
//   - MeshoptDecoder (every model in data/mudiii-assets.json uses
//     EXT_meshopt_compression; GLTFLoader handles quantization and WebP
//     natively, so one call at the loader setup `loader.setMeshoptDecoder(MeshoptDecoder)`
//     is all that's needed)
//
// Note: scripts/check-licences.mjs walks `npm ls --omit=dev`, so three
// (a devDependency) is never seen by it. three is MIT and would pass anyway.

import { build } from "esbuild";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const THREE_VENDOR_ENTRY = 'export * as THREE from "three";\n'
  + 'export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";\n'
  + 'export { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";\n'
  + 'export { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";\n';

/** Build `<siteDir>/vendor/three.js` (ESM, minified) and return
 *  { outPath, bytes }. Write-then-rename so a concurrent reader always sees a
 *  complete file — the same idiom scripts/lib/browser-bundle.mjs uses. */
export async function buildThreeVendor(siteDir = join(ROOT, "public")) {
  const outPath = join(siteDir, "vendor", "three.js");
  const result = await build({
    stdin: { contents: THREE_VENDOR_ENTRY, resolveDir: ROOT, sourcefile: "three-vendor-entry.mjs", loader: "js" },
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
  const { outPath, bytes } = await buildThreeVendor(process.argv[2]);
  console.log(`built ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
}
