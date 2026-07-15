import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYER_RANK, layerOf } from "./layer-map.mjs";
import { ALLOWED_VIOLATIONS } from "./layer-allowlist.mjs";

const SRC = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "src");

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\bfrom\s+)?["']([^"'\n]+)["']/g;
const EXPORT_FROM_RE = /(?:^|\n)\s*export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+["']([^"'\n]+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(/;

function* walkModules(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkModules(full);
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".bundle.js")) yield full;
  }
}

function importSpecifiers(text) {
  const specs = new Set();
  for (const re of [IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) specs.add(m[1]);
  }
  return specs;
}

const violations = [];
const dangling = [];
const unmapped = [];

for (const file of walkModules(SRC)) {
  const rel = path.relative(SRC, file);
  const layer = layerOf(rel);
  if (!layer) {
    unmapped.push(`src/${rel}`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");

  if (REQUIRE_RE.test(text)) violations.push(`src/${rel} calls require()`);

  for (const spec of importSpecifiers(text)) {
    const isRelative = spec.startsWith("./") || spec.startsWith("../");
    if (!isRelative) {
      if (layer === "domain") violations.push(`src/${rel} imports ${spec}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(resolved)) {
      dangling.push(`src/${rel} -> ${spec}`);
      continue;
    }
    const relTarget = path.relative(SRC, resolved);
    if (relTarget.startsWith("..")) {
      unmapped.push(`src/${rel} -> ${spec} (resolves outside src/)`);
      continue;
    }
    const targetLayer = layerOf(relTarget);
    if (!targetLayer) {
      unmapped.push(`src/${relTarget} (imported by src/${rel})`);
      continue;
    }
    const pointsUpward = LAYER_RANK[layer] < LAYER_RANK[targetLayer];
    const escapesDomain = layer === "domain" && targetLayer !== "domain";
    if (pointsUpward || escapesDomain) violations.push(`src/${rel} -> src/${relTarget}`);
  }
}

test("every module under src/ is claimed by the layer map", () => {
  assert.deepEqual(unmapped, [], `unmapped:\n${unmapped.join("\n")}`);
});

test("every relative import in src/ resolves to an existing file", () => {
  assert.deepEqual(dangling, [], `dangling imports:\n${dangling.join("\n")}`);
});

test("imports point downward and domain stays pure, up to the shrinking allowlist", () => {
  const observed = new Set(violations);
  const allowed = new Set(ALLOWED_VIOLATIONS);
  const missing = [...observed].filter((v) => !allowed.has(v)).sort();
  const stale = [...allowed].filter((v) => !observed.has(v)).sort();
  assert.deepEqual(missing, [], `new layer violations (fix the import, never extend the allowlist):\n${missing.join("\n")}`);
  assert.deepEqual(stale, [], `allowlist entries no longer observed (delete them from layer-allowlist.mjs):\n${stale.join("\n")}`);
});
