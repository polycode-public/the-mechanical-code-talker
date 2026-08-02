import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "src");

/**
 * Resolve an import specifier relative to a file, returning the normalized
 * path relative to src/ (e.g., "services/adventure.mjs").
 */
function resolveSpec(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, specifier);
  if (!fs.existsSync(resolved)) return null;
  return path.relative(SRC, resolved);
}

/**
 * Extract all top-level await import() calls and their specifiers from source.
 * Returns array of { specifier, resolvedPath, lineNum } for each top-level await import.
 * Top-level means at module scope (brace depth 0), not inside a function or block.
 */
function extractTopLevelAwaitImports(text, filePath) {
  const results = [];
  let braceDepth = 0;
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track brace depth before processing this line.
    // We check depth at the START of the line to know if this line is module-level.
    const depthAtLineStart = braceDepth;

    // Count braces in this line to update braceDepth for the next line.
    for (const char of line) {
      if (char === "{") braceDepth++;
      else if (char === "}") braceDepth--;
    }

    // Check if this line has 'await import(...)'
    const awaitImportMatch = line.match(/\bawait\s+import\s*\(\s*["']([^"']+)["']\s*\)/);
    if (awaitImportMatch) {
      // Only count it as top-level if we're at braceDepth 0 at the START of this line.
      const isModuleLevel = depthAtLineStart === 0;
      if (isModuleLevel) {
        const specifier = awaitImportMatch[1];
        const resolved = resolveSpec(filePath, specifier);
        results.push({ specifier, resolved, lineNum: i + 1 });
      }
    }
  }
  return results;
}

// The two files that have a known static import cycle and must never
// convert either to a top-level await import() of the other.
const WORLD_TEACH = path.join(SRC, "services/world-teach.mjs");
const ADVENTURE = path.join(SRC, "services/adventure.mjs");

test("world-teach.mjs does not contain top-level await import() of adventure.mjs", () => {
  const text = fs.readFileSync(WORLD_TEACH, "utf8");
  const imports = extractTopLevelAwaitImports(text, WORLD_TEACH);

  const deadlockRisk = imports.find((imp) => {
    // Check if this resolves to adventure.mjs
    return imp.resolved && imp.resolved.endsWith("services/adventure.mjs");
  });

  assert(!deadlockRisk, [
    "world-teach.mjs must never use top-level await import() for adventure.mjs:",
    `  both files already import each other statically, forming a cycle.`,
    `  converting either to top-level await import() creates a silent deadlock where both modules wait forever with no error.`,
    deadlockRisk ? `  found at line ${deadlockRisk.lineNum}: await import("${deadlockRisk.specifier}")` : "",
  ].filter(Boolean).join("\n"));
});

test("adventure.mjs does not contain top-level await import() of world-teach.mjs", () => {
  const text = fs.readFileSync(ADVENTURE, "utf8");
  const imports = extractTopLevelAwaitImports(text, ADVENTURE);

  const deadlockRisk = imports.find((imp) => {
    // Check if this resolves to world-teach.mjs
    return imp.resolved && imp.resolved.endsWith("services/world-teach.mjs");
  });

  assert(!deadlockRisk, [
    "adventure.mjs must never use top-level await import() for world-teach.mjs:",
    `  both files already import each other statically, forming a cycle.`,
    `  converting either to top-level await import() creates a silent deadlock where both modules wait forever with no error.`,
    deadlockRisk ? `  found at line ${deadlockRisk.lineNum}: await import("${deadlockRisk.specifier}")` : "",
  ].filter(Boolean).join("\n"));
});
